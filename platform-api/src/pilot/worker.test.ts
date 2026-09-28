import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../database.js";
import { command, ownerA, pilotTestDb, validDraft } from "./testSupport.js";
import { PilotTaskRepository } from "./tasks.js";
import { PersistentAdmission } from "./admission.js";
import { randomUUID } from "node:crypto";
import { workerFixture } from "./workerTestSupport.js";
import { runPilotJob } from "./worker.js";
import { GradingProviderError } from "../../../grading-gateway/src/providers/providerTypes.js";
let db: Database;
beforeEach(async () => {
  db = await pilotTestDb();
});
afterEach(async () => {
  await db?.close();
});
it("rubricAndEssayShareOneGateAndRedeliverySendsOriginalMaterialOnlyOnce", async () => {
  const s = await workerFixture(db),
    tasks = new PilotTaskRepository(db);
  const draft = await tasks.createDraft(
    ownerA,
    command({
      ...validDraft(),
      materialRefs: [
        {
          kind: "text",
          id: randomUUID(),
          displayName: "Synthetic DOCX",
          text: "Original source body.",
          warnings: ["docx_body_only"],
        },
      ],
    }),
  );
  const rubricJob = await s.jobs.enqueueMaterial(
    ownerA,
    draft.id,
    command({ kind: "rubric" }, draft.revision),
  );
  const gate = new PersistentAdmission(db),
    held = await gate.claim(s.job.id);
  expect(held.kind).toBe("claimed");
  expect(await runPilotJob(rubricJob.id, s.deps)).toBe("deferred");
  if (held.kind !== "claimed") throw Error("fixture gate");
  await gate.fail(
    held.lease,
    new GradingProviderError(
      "provider_unavailable",
      "Synthetic confirmed failure",
      false,
      undefined,
      { termination: "confirmed" },
    ),
  );
  let calls = 0;
  const deps = {
    ...s.deps,
    provider: {
      ...s.provider,
      generateRubric: async (
        input: Parameters<typeof s.provider.generateRubric>[0],
      ) => {
        calls++;
        expect(input.materials).toHaveLength(1);
        expect(input.materials[0]).toMatchObject({
          kind: "text",
          text: "Original source body.",
        });
        return {
          value: {
            taskName: "Synthetic",
            materialSummary: "Original source summary.",
            writingRequirements: ["Write a short story."],
            constraints: [],
            dimensions: validDraft().dimensions,
            reviewWarnings: ["Teacher check."],
          },
          attempts: [],
        };
      },
    },
  };
  await runPilotJob(rubricJob.id, deps);
  await runPilotJob(rubricJob.id, deps);
  const result = (await s.jobs.listAssistance(ownerA, draft.id))[0];
  expect(result).toMatchObject({
    state: "succeeded",
    result: {
      materialSummary: "Original source summary.",
      reviewWarnings: ["Teacher check."],
    },
  });
  expect(calls).toBe(1);
  expect(s.calls()).toBe(0);
  // A later manual revision is not replaced by an old AI result.
  const saved = await tasks.saveDraft(
    ownerA,
    draft.id,
    command(
      { ...draft.draft, writingRequirement: "Manual requirement." },
      draft.revision,
    ),
  );
  expect(saved.draft.writingRequirement).toBe("Manual requirement.");
  expect(await s.jobs.listAssistance(ownerA, draft.id)).toEqual([]);
});
it("closedBrowserTwoEssaysCompleteAndAckFailureDoesNotCallAgain", async () => {
  const a = await workerFixture(db),
    b = await workerFixture(db, a.store);
  expect(await runPilotJob(a.job.id, a.deps)).toBe("done");
  expect(await runPilotJob(b.job.id, b.deps)).toBe("done");
  await runPilotJob(a.job.id, a.deps);
  await runPilotJob(b.job.id, b.deps);
  expect(a.calls()).toBe(1);
  expect(b.calls()).toBe(1);
  expect(
    (await a.essays.get(ownerA, a.essay.id)).currentResult?.ai.transcript,
  ).toBe("I have a pen.");
});
it("unknownRedeliveryNeverCallsAgain", async () => {
  const s = await workerFixture(db);
  let n = 0;
  s.deps.provider = {
    ...s.provider,
    gradeEssay: async () => {
      n++;
      throw new GradingProviderError(
        "provider_timeout",
        "private",
        false,
        undefined,
        { termination: "unknown" },
      );
    },
  };
  await runPilotJob(s.job.id, s.deps);
  await runPilotJob(s.job.id, s.deps);
  expect(n).toBe(1);
  expect((await s.jobs.get(ownerA, s.job.id)).state).toBe("result_unknown");
});
it("verifiedDigestMismatchAndSpentPreparationBudgetMakeZeroCalls", async () => {
  const s = await workerFixture(db);
  s.store.objects.get(s.path)![30] ^= 1;
  await runPilotJob(s.job.id, s.deps);
  expect(s.calls()).toBe(0);
  const b = await workerFixture(db);
  let time = 0;
  await runPilotJob(b.job.id, {
    ...b.deps,
    now: () => {
      time += 300000;
      return time;
    },
  });
  expect(b.calls()).toBe(0);
});
it("confirmedTranscriptRegradeDoesNotReadImages", async () => {
  const s = await workerFixture(db);
  await runPilotJob(s.job.id, s.deps);
  const current = await s.essays.get(ownerA, s.essay.id);
  await s.essays.saveTranscript(
    ownerA,
    s.essay.id,
    command({ text: "I have two pens." }, current.revision),
  );
  await s.jobs.enqueueTask(ownerA, s.task.id, command({}));
  const job = (await s.essays.get(ownerA, s.essay.id)).currentJob!;
  const reads = s.store.reads;
  await runPilotJob(job.id, s.deps);
  expect(s.store.reads).toBe(reads);
  expect(s.calls()).toBe(2);
});
it("missingProviderPausesBeforeCallingWhileMaintenanceNeedsNoProvider", async () => {
  const s = await workerFixture(db);
  await runPilotJob(s.job.id, {
    ...s.deps,
    provider: undefined,
    providerFactory: () => {
      throw Error("configuration");
    },
  });
  expect((await s.jobs.get(ownerA, s.job.id)).state).toBe("failed");
  expect(
    (await db.query("SELECT pause_reason FROM pilot_grading.provider_gate"))
      .rows[0].pause_reason,
  ).toBe("provider_not_configured");
  expect(
    (
      await db.query("SELECT attempts FROM pilot_grading.jobs WHERE id=$1", [
        s.job.id,
      ])
    ).rows[0].attempts,
  ).toBe(0);
});
