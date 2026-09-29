import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { migrate } from "../migrate.js";
import { migratePilot } from "./migrate.js";
import type { Database } from "../database.js";
import { controlMigration } from "../../scripts/migrationControl.js";

async function fixture() {
  const db = new PGlite();
  await migrate(db);
  await migratePilot(db);
  await db.exec(
    await readFile(
      new URL("../migrations/004_pilot_migration_control.sql", import.meta.url),
      "utf8",
    ),
  );
  const connected: Database = {
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    transaction: (fn) => db.transaction(fn),
    withConnection: (fn) =>
      fn({
        query: (sql, params) => db.query(sql, params),
        signal: new AbortController().signal,
        transaction: (cb) => db.transaction(cb),
      }),
  };
  return { db, connected };
}

it("installs read-only control and backend-owned admission functions without public grants", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated");
    await migrate(db);
    await migratePilot(db);
    const sql = await readFile(
      new URL("../migrations/004_pilot_migration_control.sql", import.meta.url),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const rights = await db.query<{ safe: boolean }>(`SELECT
      has_table_privilege('wj_auth_runtime','pilot_grading.migration_control','SELECT')
      AND NOT has_table_privilege('wj_auth_runtime','pilot_grading.migration_control','UPDATE,INSERT,DELETE,TRUNCATE')
      AND NOT has_table_privilege('wj_auth_runtime','pilot_grading.migration_admissions','DELETE,TRUNCATE,INSERT,UPDATE')
      AND NOT has_function_privilege('public','pilot_grading.enter_migration(uuid)','EXECUTE')
      AND NOT has_function_privilege('anon','pilot_grading.enter_migration(uuid)','EXECUTE') AS safe`);
    expect(rights.rows[0].safe).toBe(true);
    await db.exec("SET ROLE wj_auth_runtime");
    await expect(
      db.query("UPDATE pilot_grading.migration_control SET frozen=false"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("DELETE FROM pilot_grading.migration_admissions"),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await db.query<{ frozen: boolean }>(
          "SELECT frozen FROM pilot_grading.migration_control",
        )
      ).rows[0].frozen,
    ).toBe(false);
    await db.exec("RESET ROLE");
    await db.exec(
      "UPDATE pilot_grading.migration_control SET frozen=true,frozen_at=clock_timestamp()",
    );
    await db.exec(sql);
    expect(
      (
        await db.query<{ frozen: boolean }>(
          "SELECT frozen FROM pilot_grading.migration_control",
        )
      ).rows[0].frozen,
    ).toBe(true);
  } finally {
    await db.close();
  }
});

it("freezes before reporting active admissions and rejects fresh runtime admissions", async () => {
  const { db, connected } = await fixture();
  const bound = connected.withConnection!;
  connected.withConnection = (fn) =>
    bound((c) =>
      fn({
        ...c,
        query: async (sql, params) =>
          sql.includes("pg_try_advisory_lock(1464486217,1)")
            ? ({ rows: [{ locked: false }] } as never)
            : c.query(sql, params),
      }),
    );
  try {
    expect((await controlMigration(connected, "freeze")).state).toBe(
      "waiting_operations",
    );
    await db.exec("SET ROLE wj_auth_runtime");
    expect(
      (
        await db.query<{ admitted: boolean }>(
          "SELECT pilot_grading.enter_migration('00000000-0000-4000-8000-000000000001') AS admitted",
        )
      ).rows[0].admitted,
    ).toBe(false);
  } finally {
    await db.close();
  }
});

it.each([{ args: [] }, { args: ["freeze", "--invalid-private-marker"] }])(
  "CLI fails safely before connection for invalid arguments $args",
  ({ args }) => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL("../../scripts/migrationControl.ts", import.meta.url),
        ),
        ...args,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_ADMIN_URL:
            "postgresql://private-user:private-secret@invalid.invalid/private-db",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("migration_control_failed");
  },
);

it("fails closed without backend identity and refuses releasing a different backend's marker", async () => {
  const { db } = await fixture();
  try {
    await db.exec("SET ROLE wj_auth_runtime");
    const token = "00000000-0000-4000-8000-000000000001";
    // PGlite has no pg_stat_activity row for its backend. Do not weaken the
    // production identity check to make an embedded database simulate PG races.
    await expect(
      db.query("SELECT pilot_grading.enter_migration($1::uuid) AS admitted", [
        token,
      ]),
    ).rejects.toThrow("migration_backend_identity_unavailable");
    await db.exec("RESET ROLE");
    expect(
      (await db.query("SELECT token FROM pilot_grading.migration_admissions"))
        .rows,
    ).toHaveLength(0);
    await db.query(
      "INSERT INTO pilot_grading.migration_admissions(token,backend_pid,backend_started_at) VALUES($1,-1,clock_timestamp())",
      [token],
    );
    await db.exec("SET ROLE wj_auth_runtime");
    expect(
      (
        await db.query<{ released: boolean }>(
          "SELECT pilot_grading.leave_migration($1::uuid) AS released",
          [token],
        )
      ).rows[0].released,
    ).toBe(false);
  } finally {
    await db.close();
  }
});

it("freeze persists before upload wait, preserves freeze on recheck, and needs explicit remote idle observation", async () => {
  const { db, connected } = await fixture();
  try {
    const first = await controlMigration(connected, "freeze", {
      confirmSourceUploadsIdle: true,
    });
    expect(first.state).toBe("waiting_upload_expiry");
    expect(first.remainingSeconds).toBeGreaterThan(7800);
    expect(
      (
        await db.query<{ frozen: boolean }>(
          "SELECT frozen FROM pilot_grading.migration_control",
        )
      ).rows[0].frozen,
    ).toBe(true);
    await db.exec(
      "UPDATE pilot_grading.migration_control SET drained_at=clock_timestamp()-interval '3 hours'",
    );
    expect((await controlMigration(connected, "status")).state).toBe(
      "waiting_source_upload_confirmation",
    );
    expect(
      (
        await controlMigration(connected, "freeze", {
          confirmSourceUploadsIdle: true,
        })
      ).state,
    ).toBe("ready");
    expect((await controlMigration(connected, "status")).state).toBe("ready");
    expect((await controlMigration(connected, "thaw")).state).toBe("open");
  } finally {
    await db.close();
  }
});

it("blocks lost admission markers and never silently deletes or thaws them", async () => {
  const { db, connected } = await fixture();
  try {
    await db.exec(
      "INSERT INTO pilot_grading.migration_admissions(token,backend_pid,backend_started_at) VALUES('00000000-0000-4000-8000-000000000001',-1,clock_timestamp())",
    );
    expect((await controlMigration(connected, "freeze")).state).toBe(
      "blocked_uncertain_operations",
    );
    expect((await controlMigration(connected, "thaw")).state).toBe(
      "blocked_uncertain_operations",
    );
    expect(
      (await db.query("SELECT token FROM pilot_grading.migration_admissions"))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query<{ frozen: boolean }>(
          "SELECT frozen FROM pilot_grading.migration_control",
        )
      ).rows[0].frozen,
    ).toBe(true);
  } finally {
    await db.close();
  }
});

it.each(["preparing", "calling", "result_unknown"])(
  "blocks cutover for %s execution without changing provider ownership",
  async (state) => {
    const { db, connected } = await fixture();
    try {
      // Isolate control logic using structurally valid synthetic ownership rows.
      await db.exec(
        "ALTER TABLE pilot_grading.executions DROP CONSTRAINT executions_job_id_fkey",
      );
      await db.query(
        "INSERT INTO pilot_grading.executions(id,job_id,token,fence,state,prepare_deadline) VALUES($1,$1,$1,1,$2,clock_timestamp())",
        ["00000000-0000-4000-8000-000000000001", state],
      );
      await db.exec(
        "UPDATE pilot_grading.provider_gate SET active_execution_id='00000000-0000-4000-8000-000000000001'",
      );
      const status = await controlMigration(connected, "freeze");
      expect(status.state).toBe(
        state === "result_unknown"
          ? "blocked_unknown_results"
          : "waiting_model_settlement",
      );
      expect(
        (
          await db.query<{ state: string }>(
            "SELECT state FROM pilot_grading.executions",
          )
        ).rows[0].state,
      ).toBe(state);
      expect(
        (
          await db.query<{ active_execution_id: string }>(
            "SELECT active_execution_id FROM pilot_grading.provider_gate",
          )
        ).rows[0].active_execution_id,
      ).toBe("00000000-0000-4000-8000-000000000001");
    } finally {
      await db.close();
    }
  },
);
