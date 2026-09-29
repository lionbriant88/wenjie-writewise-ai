import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import { pilotTestDb, ownerA } from "../pilot/testSupport.js";
import { workerFixture } from "../pilot/workerTestSupport.js";
import { runPilotJob } from "../pilot/worker.js";
import { createMigrationGate } from "../pilot/migrationGate.js";
import { createMaintenanceHandler } from "../pilot/maintenanceHandler.js";
import type { Database, Queryable } from "../database.js";

// Connection transport double over PGlite: tests real worker/maintenance async
// lifetime. Real PostgreSQL advisory lock behavior is tested independently.
function connectionDb(db: Database) {
  let frozen = false,
    admissions = 0;
  const query: Queryable["query"] = async (sql, params) => {
    if (sql.includes("enter_migration")) {
      if (frozen) return { rows: [{ admitted: false }] } as never;
      admissions++;
      return { rows: [{ admitted: true }] } as never;
    }
    if (sql.includes("leave_migration")) {
      admissions--;
      return { rows: [{ released: true }] } as never;
    }
    return db.query(sql, params);
  };
  return {
    db: {
      ...db,
      query,
      withConnection: async (fn) =>
        fn({
          query,
          transaction: db.transaction,
          signal: new AbortController().signal,
        }),
    } as Database,
    freeze: () => {
      frozen = true;
    },
    admissions: () => admissions,
  };
}
it("worker keeps the admission after timeout until late provider work actually settles", async () => {
  const db = await pilotTestDb();
  try {
    const s = await workerFixture(db),
      f = connectionDb(db),
      gate = createMigrationGate(f.db);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    let time = 0,
      finished = false;
    const work = runPilotJob(s.job.id, {
      ...s.deps,
      migrationGate: gate,
      now: () => (time++ === 0 ? 0 : 289000),
      provider: {
        ...s.provider,
        gradeEssay: async (input) => {
          entered();
          await waiting;
          return s.provider.gradeEssay(input);
        },
      },
    }).then(() => {
      finished = true;
    });
    await started;
    try {
      // The normal worker deadline is 290 seconds; injected clock leaves one.
      await new Promise((r) => setTimeout(r, 1100));
      expect((await s.jobs.get(ownerA, s.job.id)).state).toBe("result_unknown");
      expect(finished).toBe(false);
      expect(f.admissions()).toBe(1);
    } finally {
      release();
      await work;
    }
    expect(f.admissions()).toBe(0);
    expect(s.calls()).toBe(1);
  } finally {
    await db.close();
  }
});
it("authorized source maintenance and worker do no effects after freeze", async () => {
  const db = await pilotTestDb();
  try {
    const s = await workerFixture(db),
      f = connectionDb(db),
      gate = createMigrationGate(f.db);
    f.freeze();
    const runtime = { ...s.deps, migrationGate: gate };
    await expect(runPilotJob(s.job.id, runtime)).rejects.toMatchObject({
      code: "migration_frozen",
    });
    const app = express().get(
      "/maintenance",
      createMaintenanceHandler(
        async () => runtime,
        () => "synthetic-maintenance-secret",
      ),
    );
    expect(
      (
        await request(app)
          .get("/maintenance")
          .set("Authorization", "Bearer synthetic-maintenance-secret")
      ).status,
    ).toBe(503);
    expect(s.calls()).toBe(0);
    expect(s.queue.messages).toHaveLength(0);
    expect((await s.jobs.get(ownerA, s.job.id)).state).toBe("queued");
  } finally {
    await db.close();
  }
});
