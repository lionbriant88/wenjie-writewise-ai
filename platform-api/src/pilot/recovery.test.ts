import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../database.js";
import { ownerA, ownerB, pilotTestDb } from "./testSupport.js";
import { workerFixture } from "./workerTestSupport.js";
import { recoverPilotWork } from "./recovery.js";
import { randomUUID } from "node:crypto";
import { runPilotJob } from "./worker.js";
let db: Database;
beforeEach(async () => {
  db = await pilotTestDb();
});
afterEach(async () => {
  await db?.close();
});
it("shares the publication limit between essay jobs and maintenance continuations", async () => {
  const s = await workerFixture(db);
  for (let i = 0; i < 3; i++)
    await db.query(
      "INSERT INTO pilot_grading.maintenance_jobs(id) VALUES($1)",
      [randomUUID()],
    );
  expect((await recoverPilotWork(s.deps, 2)).published).toBeLessThanOrEqual(2);
  expect(s.queue.messages).toHaveLength(2);
  expect(
    (
      await db.query(
        "SELECT id FROM pilot_grading.maintenance_jobs WHERE sent_at IS NULL",
      )
    ).rows.length,
  ).toBeGreaterThan(0);
});
it("publishFailureAndLostOutboxAckReuseDeliveryGeneration", async () => {
  const s = await workerFixture(db);
  s.queue.fail = true;
  await expect(recoverPilotWork(s.deps, 50)).rejects.toBeDefined();
  s.queue.fail = false;
  await recoverPilotWork(s.deps, 50);
  const first = s.queue.messages[0];
  expect(first.jobId).toBe(s.job.id);
  await db.query(
    "UPDATE pilot_grading.outbox SET sent_at=NULL WHERE job_id=$1",
    [s.job.id],
  );
  await recoverPilotWork(s.deps, 50);
  expect(s.queue.messages[1].key).toBe(first.key);
  await db.query(
    "UPDATE pilot_grading.outbox SET sent_at=now()-interval '25 hours' WHERE job_id=$1",
    [s.job.id],
  );
  await recoverPilotWork(s.deps, 50);
  expect(s.queue.messages[2].key).not.toBe(first.key);
});
it("teacherRecoveryOnlyPublishesOwnedJobsAndBoundedContinuationPersists", async () => {
  const a = await workerFixture(db),
    b = await workerFixture(db, a.store, ownerB);
  await recoverPilotWork({ ...a.deps, ownerId: ownerA }, 1);
  expect(a.queue.messages.map((m) => m.jobId)).toEqual([a.job.id]);
  expect(a.queue.messages.some((m) => m.jobId === b.job.id)).toBe(false);
  const c = await workerFixture(db, a.store);
  await db.query("UPDATE pilot_grading.outbox SET sent_at=NULL");
  await recoverPilotWork(a.deps, 1);
  expect(
    (
      await db.query(
        "SELECT id FROM pilot_grading.maintenance_jobs WHERE state='queued'",
      )
    ).rows.length,
  ).toBeGreaterThan(0);
  expect(
    a.queue.messages.some((m) => m.jobId === c.job.id) ||
      a.queue.messages.length >= 2,
  ).toBe(true);
});
it("expiredMaintenanceDeliveryGetsNewGenerationAndNeverCreatesAProvider", async () => {
  const s = await workerFixture(db),
    maintenance = randomUUID();
  await db.query(
    "INSERT INTO pilot_grading.maintenance_jobs(id,sent_at) VALUES($1,now()-interval '25 hours')",
    [maintenance],
  );
  await recoverPilotWork(s.deps, 50);
  const message = s.queue.messages.find((m) => m.jobId === maintenance)!;
  expect(message.key).toBe(maintenance + ":2");
  let providerLoads = 0;
  await runPilotJob(maintenance, {
    ...s.deps,
    provider: undefined,
    providerFactory: () => {
      providerLoads++;
      throw Error("must not load");
    },
  });
  expect(providerLoads).toBe(0);
  expect(
    (
      await db.query(
        "SELECT state FROM pilot_grading.maintenance_jobs WHERE id=$1",
        [maintenance],
      )
    ).rows[0].state,
  ).toBe("done");
});
