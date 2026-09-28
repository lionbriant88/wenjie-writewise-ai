import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../database.js";
import { command, ownerA, ownerB, pilotTestDb } from "./testSupport.js";
import { seedEssay, resultFor } from "./jobTestSupport.js";
import { PilotEssayRepository } from "./essays.js";
import { PilotJobRepository } from "./jobs.js";
import { PersistentAdmission } from "./admission.js";
import { PilotTaskRepository } from "./tasks.js";
let db: Database;
beforeAll(async () => {
  db = await pilotTestDb();
});
afterAll(async () => {
  await db?.close();
});
it("attachesVerifiedOwnedPagesOnceAndRestoresThem", async () => {
  const { task, essay, uploadId } = await seedEssay(db),
    repo = new PilotEssayRepository(db);
  expect(essay.studentName).toBe("学生1");
  expect(essay.pages[0].uploadId).toBe(uploadId);
  expect((await repo.list(ownerA, task.id, {})).items).toEqual([essay]);
  await expect(repo.get(ownerB, essay.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    repo.attach(
      ownerB,
      task.id,
      command({ groups: [{ studentName: "", uploadIds: [uploadId] }] }),
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    repo.attach(
      ownerA,
      task.id,
      command({ groups: [{ studentName: "", uploadIds: [uploadId] }] }),
    ),
  ).rejects.toMatchObject({ code: "upload_already_attached" });
  expect(
    (await new PilotTaskRepository(db).get(ownerA, task.id)).counts.total,
  ).toBe(1);
});
it("rejectsOutOfRangeReviewsAndStaleRevisionsThenRestoresConfirmation", async () => {
  const { task, essay, essays } = await seedEssay(db),
    jobs = new PilotJobRepository(db),
    gate = new PersistentAdmission(db);
  await jobs.enqueueTask(ownerA, task.id, command({}));
  const job = (await essays.get(ownerA, essay.id)).currentJob!;
  const c = await gate.claim(job.id);
  if (c.kind !== "claimed") throw Error("claim");
  expect(await gate.beginCall(c.lease)).toBe(true);
  await gate.complete(
    c.lease,
    await resultFor(essay.id, task.confirmedPackage!),
  );
  const current = await essays.get(ownerA, essay.id);
  const review = {
    dimensionScores: task.confirmedPackage!.rubric.dimensions.map((d) => ({
      dimensionId: d.id,
      score: 0,
    })),
    overallComment: "Saved feedback",
    teacherSuggestion: "Try again",
    confirm: true,
  };
  await expect(
    essays.saveReview(
      ownerA,
      essay.id,
      command(
        { ...review, dimensionScores: [{ dimensionId: "content", score: 99 }] },
        current.revision,
      ),
    ),
  ).rejects.toMatchObject({ code: "invalid_request" });
  const saved = await essays.saveReview(
    ownerA,
    essay.id,
    command(review, current.revision),
  );
  expect(saved.teacherReviewed).toBe(true);
  expect(saved.currentResult?.review?.overallComment).toBe("Saved feedback");
  await expect(
    essays.saveReview(ownerA, essay.id, command(review, current.revision)),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(await new PilotEssayRepository(db).get(ownerA, essay.id)).toEqual(
    saved,
  );
  expect(
    (await new PilotTaskRepository(db).get(ownerA, task.id)).counts.completed,
  ).toBe(1);
  const edited = await essays.saveTranscript(
    ownerA,
    essay.id,
    command({ text: "I have two pens." }, saved.revision),
  );
  expect(edited.currentResult).toBeNull();
  expect(edited.teacherReviewed).toBe(false);
  expect(edited.sourceRevision).toBe(2);
});
