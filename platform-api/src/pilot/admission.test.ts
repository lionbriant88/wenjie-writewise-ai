import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../database.js";
import { command, ownerA, pilotTestDb, validDraft } from "./testSupport.js";
import { seedEssay, resultFor } from "./jobTestSupport.js";
import { PilotJobRepository } from "./jobs.js";
import { PersistentAdmission, resumeKnownPause } from "./admission.js";
import { PilotTaskRepository } from "./tasks.js";
import { GradingProviderError } from "../../../grading-gateway/src/providers/providerTypes.js";
let db: Database;
beforeEach(async () => {
  db = await pilotTestDb();
});
afterEach(async () => {
  await db?.close();
});
async function queued() {
  const s = await seedEssay(db);
  const jobs = new PilotJobRepository(db);
  await jobs.enqueueTask(ownerA, s.task.id, command({}));
  return {
    ...s,
    jobs,
    job: (await s.essays.get(ownerA, s.essay.id)).currentJob!,
    gate: new PersistentAdmission(db),
  };
}
async function claimed() {
  const s = await queued();
  const c = await s.gate.claim(s.job.id);
  if (c.kind !== "claimed") throw Error("claim");
  return { ...s, ...c };
}
it("differentStagesShareOneSlotAndPreparingCanBeFencedBeforeCall", async () => {
  const s = await claimed(),
    tasks = new PilotTaskRepository(db),
    d = await tasks.createDraft(ownerA, command(validDraft()));
  const other = await s.jobs.enqueueMaterial(
    ownerA,
    d.id,
    command({ kind: "rubric" }, d.revision),
  );
  expect((await new PersistentAdmission(db).claim(other.id)).kind).toBe("busy");
  await db.exec(
    "UPDATE pilot_grading.executions SET prepare_deadline=now()-interval '1 second'",
  );
  await s.gate.recoverExpired();
  const replacement = await s.gate.claim(other.id);
  expect(replacement.kind).toBe("claimed");
  expect(await s.gate.beginCall(s.lease)).toBe(false);
});
it("successfulPersistenceSurvivesAckFailure", async () => {
  const s = await claimed();
  await s.gate.beginCall(s.lease);
  const result = await resultFor(s.essay.id, s.task.confirmedPackage!);
  await s.gate.complete(s.lease, result);
  await s.gate.complete(s.lease, result);
  expect((await new PersistentAdmission(db).claim(s.job.id)).kind).toBe(
    "terminal",
  );
  expect(
    (await db.query("SELECT job_id FROM pilot_grading.grading_results")).rows,
  ).toHaveLength(1);
  expect(
    (await s.essays.get(ownerA, s.essay.id)).currentResult?.ai.transcript,
  ).toBe("I have a pen.");
});
it("lateResultDoesNotReplaceEditedTranscriptOrReview", async () => {
  const s = await claimed();
  await s.gate.beginCall(s.lease);
  const edit = await s.essays.saveTranscript(
    ownerA,
    s.essay.id,
    command({ text: "Teacher correction." }, s.essay.revision),
  );
  await s.gate.complete(
    s.lease,
    await resultFor(s.essay.id, s.task.confirmedPackage!),
  );
  const restored = await s.essays.get(ownerA, s.essay.id);
  expect(restored.confirmedTranscript).toBe(edit.confirmedTranscript);
  expect(restored.currentResult).toBeNull();
  expect(
    (await db.query("SELECT job_id FROM pilot_grading.grading_results")).rows,
  ).toHaveLength(1);
});
it("unknownLeaseNeverExpiresIntoRetryButOriginalLateResultCanFinish", async () => {
  const s = await claimed();
  await s.gate.beginCall(s.lease);
  await db.exec(
    "UPDATE pilot_grading.executions SET call_deadline=now()-interval '1 day'",
  );
  await s.gate.recoverExpired();
  expect((await s.jobs.get(ownerA, s.job.id)).state).toBe("result_unknown");
  expect((await s.gate.claim(s.job.id)).kind).toBe("busy");
  await expect(
    s.jobs.retryKnown(
      ownerA,
      s.job.id,
      command({}, (await s.jobs.get(ownerA, s.job.id)).revision),
    ),
  ).rejects.toMatchObject({ code: "retry_not_allowed" });
  await expect(
    resumeKnownPause(db, 1, {
      GRADING_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "synthetic",
    }),
  ).rejects.toBeDefined();
  await s.gate.complete(
    { ...s.lease, token: "00000000-0000-4000-8000-000000000099" },
    await resultFor(s.essay.id, s.task.confirmedPackage!),
  );
  expect((await s.jobs.get(ownerA, s.job.id)).state).toBe("result_unknown");
  await s.gate.complete(
    s.lease,
    await resultFor(s.essay.id, s.task.confirmedPackage!),
  );
  expect((await s.jobs.get(ownerA, s.job.id)).state).toMatch(
    /succeeded|partial/,
  );
});
it("onlyDirectEaccesConnectReleasesSlotAndAbortWins", async () => {
  for (const [cause, aborted, confirmed] of [
    [{ code: "EACCES", syscall: "connect" }, false, true],
    [{ code: "ECONNRESET", syscall: "connect" }, false, false],
    [{ cause: { code: "EACCES", syscall: "connect" } }, false, false],
    [{ code: "EACCES", syscall: "connect" }, true, false],
  ] as const) {
    const s = await claimed();
    await s.gate.beginCall(s.lease);
    await s.gate.fail(s.lease, new Error("private", { cause }), { aborted });
    expect((await s.jobs.get(ownerA, s.job.id)).state).toBe(
      confirmed ? "failed" : "result_unknown",
    );
    if (!confirmed)
      await s.gate.complete(
        s.lease,
        await resultFor(s.essay.id, s.task.confirmedPackage!),
      );
  }
});
it("knownAuthPauseRequiresMaintenanceCasAndNeverOverridesAnActiveLease", async () => {
  const s = await claimed();
  await s.gate.beginCall(s.lease);
  await s.gate.fail(
    s.lease,
    new GradingProviderError(
      "provider_auth_failed",
      "private",
      true,
      undefined,
      { termination: "confirmed", pauseAdmission: true },
    ),
  );
  const other = await queued();
  expect((await other.gate.claim(other.job.id)).kind).toBe("paused");
  const rev = Number(
    (await db.query("SELECT pause_revision FROM pilot_grading.provider_gate"))
      .rows[0].pause_revision,
  );
  await expect(
    resumeKnownPause(db, rev - 1, {
      GRADING_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "synthetic",
    }),
  ).rejects.toBeDefined();
  await resumeKnownPause(db, rev, {
    GRADING_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "synthetic",
  });
  expect((await other.gate.claim(other.job.id)).kind).toBe("claimed");
});
it("disabledOwnerCancelsBeforeCallAndDeletedTaskLateResultStoresNoContent", async () => {
  const s = await claimed();
  await db.query(
    "UPDATE pilot_auth.accounts SET status='disabled' WHERE id=$1",
    [ownerA],
  );
  expect(await s.gate.beginCall(s.lease)).toBe(false);
  await db.query("UPDATE pilot_auth.accounts SET status='active' WHERE id=$1", [
    ownerA,
  ]);
  const other = await claimed();
  await other.gate.beginCall(other.lease);
  await db.query(
    "UPDATE pilot_grading.tasks SET deleted_at=now() WHERE id=$1",
    [other.task.id],
  );
  await other.gate.complete(
    other.lease,
    await resultFor(other.essay.id, other.task.confirmedPackage!),
  );
  expect(
    (await db.query("SELECT * FROM pilot_grading.grading_results")).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "SELECT active_execution_id FROM pilot_grading.provider_gate",
      )
    ).rows[0].active_execution_id,
  ).toBeNull();
});
it("known429HasBoundedBackoffAndKnownFailureRetryHasTwoAttemptCap", async () => {
  const s = await queued();
  for (let i = 0; i < 6; i++) {
    const c = await s.gate.claim(s.job.id);
    if (c.kind !== "claimed") throw Error("claim");
    await s.gate.beginCall(c.lease);
    await s.gate.fail(
      c.lease,
      new GradingProviderError(
        "provider_rate_limited",
        "private",
        true,
        undefined,
        { termination: "confirmed", retryAfterMs: 3000 },
      ),
    );
    const j = await s.jobs.get(ownerA, s.job.id);
    expect(j.state).toBe(i < 5 ? "queued" : "failed");
    if (i < 5)
      expect(new Date(j.retryAt!).getTime()).toBeGreaterThan(Date.now());
    await db.query("UPDATE pilot_grading.jobs SET retry_at=now() WHERE id=$1", [
      s.job.id,
    ]);
  }
  const failed = await s.jobs.get(ownerA, s.job.id);
  expect(failed.retryable).toBe(false);
  const k = await claimed();
  await k.gate.beginCall(k.lease);
  await k.gate.fail(
    k.lease,
    new GradingProviderError(
      "provider_invalid_response",
      "private",
      true,
      undefined,
      { termination: "confirmed" },
    ),
  );
  const first = await k.jobs.get(ownerA, k.job.id);
  await k.jobs.retryKnown(ownerA, k.job.id, command({}, first.revision));
  const c = await k.gate.claim(k.job.id);
  if (c.kind !== "claimed") throw Error("claim");
  await k.gate.beginCall(c.lease);
  await k.gate.fail(
    c.lease,
    new GradingProviderError(
      "provider_invalid_response",
      "private",
      true,
      undefined,
      { termination: "confirmed" },
    ),
  );
  await expect(
    k.jobs.retryKnown(
      ownerA,
      k.job.id,
      command({}, (await k.jobs.get(ownerA, k.job.id)).revision),
    ),
  ).rejects.toMatchObject({ code: "retry_not_allowed" });
});
