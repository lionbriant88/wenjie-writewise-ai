import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresDatabase, type Database } from "../src/database.js";
export type HandoffMode = "to-postgres" | "to-vercel";
const jobs = `SELECT o.job_id,o.generation,o.available_at FROM pilot_grading.outbox o
 JOIN pilot_grading.jobs j ON j.id=o.job_id
 JOIN pilot_grading.tasks t ON t.owner_id=j.owner_id AND t.id=j.task_id
 JOIN pilot_auth.accounts a ON a.id=j.owner_id
 WHERE j.state='queued' AND t.deleted_at IS NULL AND a.status='active' AND a.role='teacher'`;
const maintenance = `SELECT m.id,m.generation,m.created_at FROM pilot_grading.maintenance_jobs m
 LEFT JOIN pilot_auth.accounts a ON a.id=m.owner_id
 WHERE m.state='queued' AND (m.owner_id IS NULL OR (a.status='active' AND a.role='teacher'))`;

/** Explicit operational handoff only; never called by runtime/startup/migration. */
export async function handoffQueue(
  db: Database,
  mode: HandoffMode,
  expectedDatabase: string,
): Promise<{ jobs: number; maintenance: number }> {
  if (
    !db.withConnection ||
    !["to-postgres", "to-vercel"].includes(mode) ||
    !expectedDatabase
  )
    throw Error("queue_handoff_configuration_invalid");
  return db.withConnection(async (connection) => {
    let adminLocked = false,
      drainLocked = false;
    try {
      adminLocked =
        (
          await connection.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(1464486217,2) AS locked",
          )
        ).rows[0]?.locked === true;
      if (!adminLocked) throw Error("queue_handoff_admin_busy");
      drainLocked =
        (
          await connection.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(1464486217,1) AS locked",
          )
        ).rows[0]?.locked === true;
      if (!drainLocked) throw Error("queue_handoff_not_drained");
      return await connection.transaction(async (tx) => {
        const identity = (
          await tx.query<{ name: string }>("SELECT current_database() AS name")
        ).rows[0];
        if (identity?.name !== expectedDatabase)
          throw Error("queue_handoff_database_mismatch");
        const state = (
          await tx.query<{ safe: boolean }>(`SELECT frozen
          AND NOT EXISTS(SELECT 1 FROM pilot_grading.migration_admissions)
          AND NOT EXISTS(SELECT 1 FROM pilot_grading.executions WHERE state IN ('preparing','calling','result_unknown'))
          AND NOT EXISTS(SELECT 1 FROM pilot_grading.jobs WHERE state IN ('running','result_unknown'))
          AND NOT EXISTS(SELECT 1 FROM pilot_grading.provider_gate WHERE active_execution_id IS NOT NULL) AS safe
          FROM pilot_grading.migration_control WHERE singleton=true`)
        ).rows[0];
        if (state?.safe !== true)
          throw Error("queue_handoff_not_frozen_and_settled");
        if (mode === "to-postgres") {
          // Identity and absolute availability survive transfer. Existing terminal
          // deliveries are intentionally not reopened by this idempotent insert.
          const seededJobs = await tx.query(`WITH eligible AS (${jobs})
            INSERT INTO pilot_grading.deliveries(delivery_key,job_id,available_at)
            SELECT job_id::text||':'||generation,job_id,available_at FROM eligible
            ON CONFLICT(delivery_key) DO NOTHING RETURNING delivery_key`);
          const seededMaintenance =
            await tx.query(`WITH eligible AS (${maintenance})
            INSERT INTO pilot_grading.deliveries(delivery_key,job_id,available_at)
            SELECT id::text||':'||generation,id,created_at FROM eligible
            ON CONFLICT(delivery_key) DO NOTHING RETURNING delivery_key`);
          return {
            jobs: seededJobs.rows.length,
            maintenance: seededMaintenance.rows.length,
          };
        }
        // Run only on the fully restored, frozen source during an explicitly
        // authorized reverse handoff. Recovery publishes after later thaw; no
        // Vercel/model API is used here and no grading identity is regenerated.
        const resetJobs = await tx.query(`WITH eligible AS (${jobs})
          UPDATE pilot_grading.outbox o SET sent_at=NULL FROM eligible e
          WHERE o.job_id=e.job_id AND o.sent_at IS NOT NULL RETURNING o.job_id`);
        const resetMaintenance =
          await tx.query(`WITH eligible AS (${maintenance})
          UPDATE pilot_grading.maintenance_jobs m SET sent_at=NULL FROM eligible e
          WHERE m.id=e.id AND m.sent_at IS NOT NULL RETURNING m.id`);
        return {
          jobs: resetJobs.rows.length,
          maintenance: resetMaintenance.rows.length,
        };
      });
    } finally {
      if (drainLocked)
        await connection.query("SELECT pg_advisory_unlock(1464486217,1)");
      if (adminLocked)
        await connection.query("SELECT pg_advisory_unlock(1464486217,2)");
    }
  });
}

export function readHandoffConfig(
  args: string[],
  env: NodeJS.ProcessEnv,
): { mode: HandoffMode; expectedDatabase: string; url: string; ca: string } {
  const [mode, flag, expectedDatabase, ...extra] = args;
  if (
    !["to-postgres", "to-vercel"].includes(mode) ||
    flag !== "--expected-database" ||
    !expectedDatabase ||
    extra.length ||
    !env.DATABASE_ADMIN_URL ||
    !env.DATABASE_CA_CERT?.trim()
  )
    throw Error("queue_handoff_configuration_invalid");
  const url = new URL(env.DATABASE_ADMIN_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password ||
    url.pathname !== "/" + expectedDatabase
  )
    throw Error("queue_handoff_configuration_invalid");
  if (mode === "to-postgres") {
    if (
      url.hostname !== "127.0.0.1" ||
      !/^writewise_[a-z0-9_]+$/.test(expectedDatabase)
    )
      throw Error("queue_handoff_configuration_invalid");
  } else if (
    url.hostname !== "aws-0-ap-southeast-1.pooler.supabase.com" ||
    url.port !== "5432" ||
    url.username !== "postgres.wudbhdyqgnbnuorebhnu" ||
    expectedDatabase !== "postgres"
  ) {
    throw Error("queue_handoff_configuration_invalid");
  }
  return {
    mode: mode as HandoffMode,
    expectedDatabase,
    url: env.DATABASE_ADMIN_URL,
    ca: env.DATABASE_CA_CERT,
  };
}
export async function runQueueHandoff(args: string[], env: NodeJS.ProcessEnv) {
  const config = readHandoffConfig(args, env);
  const db = createPostgresDatabase(config.url, config.ca);
  try {
    return await handoffQueue(db, config.mode, config.expectedDatabase);
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runQueueHandoff(process.argv.slice(2), process.env)
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error("queue_handoff_failed");
      process.exitCode = 1;
    });
}
