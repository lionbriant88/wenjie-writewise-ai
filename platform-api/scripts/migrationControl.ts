import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPostgresDatabase,
  type Database,
  type Queryable,
} from "../src/database.js";
export type MigrationControlCommand = "freeze" | "status" | "thaw";
export type MigrationControlState =
  | "open"
  | "waiting_operations"
  | "blocked_uncertain_operations"
  | "blocked_unknown_results"
  | "waiting_model_settlement"
  | "waiting_upload_expiry"
  | "waiting_source_upload_confirmation"
  | "ready"
  | "admin_busy";
export interface MigrationControlStatus {
  state: MigrationControlState;
  remainingSeconds: number;
  admissions: number;
  activeExecutions: number;
  unknownResults: number;
}
type Snapshot = Record<string, unknown> & {
  frozen: boolean;
  drained: boolean;
  uploads_idle: boolean;
  remaining: number;
  admissions: number;
  active: number;
  unknown: number;
  running: number;
  occupied: number;
};
// 7200 s source upload ticket + 120 s signing/clock margin + 600 s in-flight
// grace. last_signed_at precedes async signing, so it is not a safe exact expiry.
// First verified drain is a conservative upper bound on completed signing.
// This time bound alone cannot prove a remote PUT finished: operator observation
// is also mandatory. No command sleeps for two hours; freeze/status can be rerun.
const SOURCE_UPLOAD_WAIT_SECONDS = 7920;
async function snapshot(db: Queryable): Promise<Snapshot> {
  const row = (
    await db.query<Snapshot>(
      `SELECT frozen,drained_at IS NOT NULL AS drained,
    uploads_idle_confirmed_at IS NOT NULL AS uploads_idle,
    CASE WHEN drained_at IS NULL THEN $1::integer ELSE
      GREATEST(0,ceil(extract(epoch FROM drained_at + $1 * interval '1 second' - clock_timestamp())))::integer END AS remaining,
    (SELECT count(*)::integer FROM pilot_grading.migration_admissions) AS admissions,
    (SELECT count(*)::integer FROM pilot_grading.executions WHERE state IN ('preparing','calling')) AS active,
    ((SELECT count(*) FROM pilot_grading.executions WHERE state='result_unknown') +
     (SELECT count(*) FROM pilot_grading.jobs WHERE state='result_unknown'))::integer AS unknown,
    (SELECT count(*)::integer FROM pilot_grading.jobs WHERE state='running') AS running,
    (SELECT count(*)::integer FROM pilot_grading.provider_gate WHERE active_execution_id IS NOT NULL) AS occupied
    FROM pilot_grading.migration_control WHERE singleton=true`,
      [SOURCE_UPLOAD_WAIT_SECONDS],
    )
  ).rows[0];
  if (!row) throw Error("migration_control_missing");
  return row;
}
function status(
  row: Snapshot,
  state: MigrationControlState,
): MigrationControlStatus {
  return {
    state,
    remainingSeconds: row.remaining,
    admissions: row.admissions,
    activeExecutions: row.active,
    unknownResults: row.unknown,
  };
}
/** Admin-only. All lock/unlock statements use the same checked-out connection. */
export async function controlMigration(
  db: Database,
  command: MigrationControlCommand,
  options: { confirmSourceUploadsIdle?: boolean } = {},
): Promise<MigrationControlStatus> {
  if (!db.withConnection) throw Error("migration_connection_required");
  if (!["freeze", "status", "thaw"].includes(command))
    throw Error("migration_command_invalid");
  return db.withConnection(async (connection) => {
    const locked = (
      await connection.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(1464486217,2) AS locked",
      )
    ).rows[0]?.locked;
    if (!locked)
      return {
        state: "admin_busy",
        remainingSeconds: 0,
        admissions: 0,
        activeExecutions: 0,
        unknownResults: 0,
      };
    let drainLocked = false;
    try {
      // Autocommit BEFORE attempting the exclusive drain lock: incoming sessions
      // see frozen immediately while already-admitted work can still settle.
      if (command === "freeze")
        await connection.query(`UPDATE pilot_grading.migration_control
        SET frozen=true,frozen_at=clock_timestamp(),drained_at=NULL,uploads_idle_confirmed_at=NULL WHERE singleton=true AND NOT frozen`);
      let row = await snapshot(connection);
      if (!row.frozen) return status(row, "open");
      drainLocked =
        (
          await connection.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(1464486217,1) AS locked",
          )
        ).rows[0]?.locked === true;
      if (!drainLocked) return status(row, "waiting_operations");
      row = await snapshot(connection);
      if (row.admissions) return status(row, "blocked_uncertain_operations");
      if (row.unknown) return status(row, "blocked_unknown_results");
      if (row.active || row.running || row.occupied)
        return status(row, "waiting_model_settlement");
      if (command === "thaw") {
        await connection.query(`UPDATE pilot_grading.migration_control SET frozen=false,frozen_at=NULL,
          drained_at=NULL,uploads_idle_confirmed_at=NULL WHERE singleton=true`);
        return status(await snapshot(connection), "open");
      }
      if (command === "freeze" && !row.drained) {
        await connection.query(
          "UPDATE pilot_grading.migration_control SET drained_at=clock_timestamp() WHERE singleton=true AND drained_at IS NULL",
        );
        row = await snapshot(connection);
      }
      if (!row.drained || row.remaining > 0)
        return status(row, "waiting_upload_expiry");
      if (command === "freeze" && options.confirmSourceUploadsIdle === true) {
        await connection.query(
          "UPDATE pilot_grading.migration_control SET uploads_idle_confirmed_at=clock_timestamp() WHERE singleton=true",
        );
        row = await snapshot(connection);
      }
      return status(
        row,
        row.uploads_idle ? "ready" : "waiting_source_upload_confirmation",
      );
    } finally {
      if (drainLocked)
        await connection.query("SELECT pg_advisory_unlock(1464486217,1)");
      await connection.query("SELECT pg_advisory_unlock(1464486217,2)");
    }
  });
}
export async function runMigrationControl(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<MigrationControlStatus> {
  const [command, flag, ...extra] = args;
  if (
    !command ||
    !["freeze", "status", "thaw"].includes(command) ||
    extra.length ||
    (flag !== undefined &&
      (command !== "freeze" || flag !== "--confirm-source-uploads-idle"))
  )
    throw Error("migration_usage_invalid");
  if (!env.DATABASE_ADMIN_URL) throw Error("admin_database_required");
  const db = createPostgresDatabase(
    env.DATABASE_ADMIN_URL,
    env.DATABASE_CA_CERT,
  );
  try {
    return await controlMigration(db, command as MigrationControlCommand, {
      confirmSourceUploadsIdle: flag !== undefined,
    });
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runMigrationControl(process.argv.slice(2), process.env)
    .then((result) => {
      // Fixed states and aggregate counts only; never log a database error or URL.
      console.log(JSON.stringify(result));
      process.exitCode = ["open", "ready"].includes(result.state)
        ? 0
        : result.state.startsWith("blocked_")
          ? 3
          : 2;
    })
    .catch(() => {
      console.error("migration_control_failed");
      process.exitCode = 1;
    });
}
