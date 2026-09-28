import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../database.js";
import { PilotTaskRepository } from "./tasks.js";
import {
  command,
  ownerA,
  ownerB,
  pilotTestDb,
  validDraft,
} from "./testSupport.js";
let db: Database;
let repo: PilotTaskRepository;
beforeAll(async () => {
  db = await pilotTestDb();
  repo = new PilotTaskRepository(db);
});
afterAll(async () => {
  await db?.close();
});
describe("owned task persistence", () => {
  it("isolatesOwnersAndRejectsCompositeForeignKeys", async () => {
    const task = await repo.createDraft(ownerA, command(validDraft()));
    await expect(repo.get(ownerB, task.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await repo.list(ownerB, {})).items).toHaveLength(0);
    await expect(
      db.query(
        "INSERT INTO pilot_grading.task_revisions(owner_id,task_id,revision,package) VALUES($1,$2,1,$3)",
        [ownerB, task.id, {}],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("replaysCommittedCommandAfterLostResponse", async () => {
    const c = command(validDraft());
    const [a, b] = await Promise.all([
      repo.createDraft(ownerA, c),
      new PilotTaskRepository(db).createDraft(ownerA, c),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      repo.createDraft(ownerA, {
        ...c,
        value: { ...c.value, taskName: "Changed" },
      }),
    ).rejects.toMatchObject({ code: "command_conflict" });
  });
  it("savesDraftAndRejectsStaleWritesWithoutOverwriting", async () => {
    const task = await repo.createDraft(ownerA, command(validDraft()));
    const updated = await repo.saveDraft(
      ownerA,
      task.id,
      command({ ...validDraft(), taskName: "Saved title" }, task.revision),
    );
    expect(updated.revision).toBe(2);
    await expect(
      repo.saveDraft(ownerA, task.id, command(validDraft(), 1)),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(
      (await new PilotTaskRepository(db).get(ownerA, task.id)).draft.taskName,
    ).toBe("Saved title");
  });
  it("confirmsOnlyValidRubric", async () => {
    const task = await repo.createDraft(
      ownerA,
      command({ ...validDraft(), materialProcessingStatus: "failed" as const }),
    );
    const confirmed = await repo.confirm(
      ownerA,
      task.id,
      command({}, task.revision),
    );
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.rubricRevision).toBe(1);
    expect(confirmed.confirmedPackage?.rubric.taskName).toBe("作文批改任务");
    expect(confirmed.confirmedPackage?.writingRequirements).toEqual([
      "Write a short story.",
    ]);
    expect(
      confirmed.confirmedPackage?.rubric.dimensions.map((d) => d.weight),
    ).toEqual([40, 40, 15, 5]);
    for (const draft of [
      { ...validDraft(), writingRequirement: "" },
      { ...validDraft(), dimensions: validDraft().dimensions.slice(0, 3) },
      { ...validDraft(), fullScore: 0 },
    ]) {
      const invalid = await repo.createDraft(ownerA, command(draft));
      await expect(
        repo.confirm(ownerA, invalid.id, command({}, invalid.revision)),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
  });
  it("deletedTaskCannotBeResurrectedByCommandReplay", async () => {
    const c = command(validDraft());
    const task = await repo.createDraft(ownerA, c);
    await db.query(
      "UPDATE pilot_grading.tasks SET deleted_at=now() WHERE owner_id=$1 AND id=$2",
      [ownerA, task.id],
    );
    await expect(repo.createDraft(ownerA, c)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
