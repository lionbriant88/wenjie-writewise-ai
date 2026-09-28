import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../database.js";
import {
  command,
  ownerA,
  ownerB,
  pilotTestDb,
  validDraft,
} from "./testSupport.js";
import { seedEssay } from "./jobTestSupport.js";
import { PilotJobRepository } from "./jobs.js";
import { PilotTaskRepository } from "./tasks.js";
let db: Database;
beforeAll(async () => {
  db = await pilotTestDb();
});
afterAll(async () => {
  await db?.close();
});
it("twoRepositoriesCompeteForOneSourceRubricJobAndOutbox", async () => {
  const { task, essay, essays } = await seedEssay(db),
    a = new PilotJobRepository(db),
    b = new PilotJobRepository(db);
  const results = await Promise.all([
    a.enqueueTask(ownerA, task.id, command({})),
    b.enqueueTask(ownerA, task.id, command({})),
  ]);
  expect(results.reduce((n, x) => n + x.accepted, 0)).toBe(1);
  const job = (await essays.get(ownerA, essay.id)).currentJob!;
  expect(
    (
      await db.query("SELECT id FROM pilot_grading.jobs WHERE essay_id=$1", [
        essay.id,
      ])
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "SELECT job_id FROM pilot_grading.outbox WHERE job_id=$1",
        [job.id],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(b.get(ownerB, job.id)).rejects.toMatchObject({
    code: "not_found",
  });
  const edited = await essays.saveTranscript(
    ownerA,
    essay.id,
    command({ text: "A revised sentence." }, essay.revision),
  );
  expect(edited.sourceRevision).toBe(2);
  expect(await a.enqueueTask(ownerA, task.id, command({}))).toEqual({
    accepted: 0,
  });
  await expect(
    a.retryKnown(ownerA, job.id, command({}, job.revision)),
  ).rejects.toMatchObject({ code: "retry_not_allowed" });
});
it("materialJobsSnapshotCurrentDraftAndDeduplicate", async () => {
  const tasks = new PilotTaskRepository(db),
    draft = await tasks.createDraft(ownerA, command(validDraft())),
    jobs = new PilotJobRepository(db);
  const a = await jobs.enqueueMaterial(
    ownerA,
    draft.id,
    command({ kind: "rubric" }, draft.revision),
  );
  const b = await jobs.enqueueMaterial(
    ownerA,
    draft.id,
    command({ kind: "rubric" }, draft.revision),
  );
  expect(a.id).toBe(b.id);
  expect(a.kind).toBe("rubric");
  await expect(
    jobs.enqueueMaterial(
      ownerB,
      draft.id,
      command({ kind: "rubric" }, draft.revision),
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});
