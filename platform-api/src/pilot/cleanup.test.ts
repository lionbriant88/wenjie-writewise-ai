import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../database.js";
import { command, ownerA, ownerB, pilotTestDb } from "./testSupport.js";
import { workerFixture } from "./workerTestSupport.js";
import { PilotCleanupService } from "./cleanup.js";
import { PersistentAdmission } from "./admission.js";
import { resultFor } from "./jobTestSupport.js";
import { GradingProviderError } from "../../../grading-gateway/src/providers/providerTypes.js";
let db: Database;
beforeEach(async () => {
  db = await pilotTestDb();
});
afterEach(async () => {
  await db?.close();
});
it("deleteDuringUnknownExecutionKeepsTombstoneWithoutStudentContent", async () => {
  const s = await workerFixture(db),
    gate = new PersistentAdmission(db),
    c = await gate.claim(s.job.id);
  if (c.kind !== "claimed") throw Error("claim");
  await gate.beginCall(c.lease);
  await gate.fail(
    c.lease,
    new GradingProviderError("provider_timeout", "private", false, undefined, {
      termination: "unknown",
    }),
  );
  const cleanup = new PilotCleanupService(db, s.store);
  await cleanup.deleteTask(ownerA, s.task.id, command({}, s.task.revision));
  await expect(s.essays.get(ownerA, s.essay.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await cleanup.runBatch(50);
  const j = (
    await db.query(
      "SELECT input_snapshot,state FROM pilot_grading.jobs WHERE id=$1",
      [s.job.id],
    )
  ).rows[0];
  expect(j).toMatchObject({ input_snapshot: {}, state: "result_unknown" });
  expect(
    (
      await db.query(
        "SELECT active_execution_id FROM pilot_grading.provider_gate",
      )
    ).rows[0].active_execution_id,
  ).toBe(c.lease.executionId);
  await gate.complete(
    c.lease,
    await resultFor(s.essay.id, s.task.confirmedPackage!),
  );
  expect(
    (await db.query("SELECT * FROM pilot_grading.grading_results")).rows,
  ).toHaveLength(0);
});
it("cleanupNeverDeletesAttachedOrForeignUploadAndWaitsForUploadTicketExpiry", async () => {
  const a = await workerFixture(db),
    b = await workerFixture(db, a.store, ownerB),
    cleanup = new PilotCleanupService(db, a.store);
  await db.exec(
    "UPDATE pilot_grading.uploads SET created_at=now()-interval '2 days',last_signed_at=now()-interval '3 hours'",
  );
  await cleanup.runBatch(50, ownerA);
  expect(a.store.removed).toEqual([]);
  await expect(
    cleanup.deleteTask(ownerA, b.task.id, command({}, b.task.revision)),
  ).rejects.toMatchObject({ code: "not_found" });
  await db.query(
    "UPDATE pilot_grading.uploads SET last_signed_at=now() WHERE id=$1",
    [a.uploadId],
  );
  await cleanup.deleteTask(ownerA, a.task.id, command({}, a.task.revision));
  await cleanup.runBatch(50, ownerA);
  expect(a.store.removed).toEqual([]);
  await db.query(
    "UPDATE pilot_grading.uploads SET last_signed_at=now()-interval '3 hours' WHERE id=$1",
    [a.uploadId],
  );
  await cleanup.runBatch(50, ownerA);
  expect(a.store.removed).toEqual([a.path]);
  expect(a.store.objects.has(b.path)).toBe(true);
});
it("preparingWorkerKeepsObjectsUntilItsFenceIsRevoked", async () => {
  const s = await workerFixture(db),
    gate = new PersistentAdmission(db);
  await gate.claim(s.job.id);
  const cleanup = new PilotCleanupService(db, s.store);
  await db.query(
    "UPDATE pilot_grading.uploads SET last_signed_at=now()-interval '3 hours' WHERE id=$1",
    [s.uploadId],
  );
  await cleanup.deleteTask(ownerA, s.task.id, command({}, s.task.revision));
  await cleanup.runBatch(50);
  expect(s.store.removed).toEqual([]);
  await db.exec(
    "UPDATE pilot_grading.executions SET prepare_deadline=now()-interval '1 second'",
  );
  await gate.recoverExpired();
  await cleanup.runBatch(50);
  expect(s.store.removed).toEqual([s.path]);
});
