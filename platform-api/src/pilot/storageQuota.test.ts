import { afterAll, beforeAll, expect, it } from "vitest";
import { StorageQuota } from "./storageQuota.js";
import { PilotUploadService } from "./uploads.js";
import { PilotTaskRepository } from "./tasks.js";
import {
  pilotTestDb,
  ownerA,
  ownerB,
  command,
  validDraft,
} from "./testSupport.js";
import type { Database } from "../database.js";
let db: Database;
beforeAll(async () => {
  db = await pilotTestDb();
});
afterAll(async () => {
  await db?.close();
});
it("serializes global reservations, counts deleted retained objects, and does not charge receipt replay", async () => {
  const quota = new StorageQuota(100);
  const storage = {
    signUpload: async () => ({ url: "https://example.test", expiresAt: "" }),
    signRead: async () => "",
    read: async () => ({ bytes: new Uint8Array(), contentType: "image/png" }),
    remove: async () => {},
  };
  const uploads = new PilotUploadService(db, storage, quota);
  const tasks = new PilotTaskRepository(db);
  const a = await tasks.createDraft(ownerA, command(validDraft()));
  const b = await tasks.createDraft(ownerB, command(validDraft()));
  const input = command({
    purpose: "material" as const,
    mimeType: "image/png" as const,
    size: 60,
    label: "synthetic",
  });
  const results = await Promise.allSettled([
    uploads.reserve(ownerA, a.id, input),
    uploads.reserve(ownerB, b.id, input),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "storage_quota_exceeded", status: 503 },
  });
  const winner =
    results[0].status === "fulfilled"
      ? { owner: ownerA, task: a }
      : { owner: ownerB, task: b };
  const first = await uploads.reserve(winner.owner, winner.task.id, input);
  expect(
    (await db.query("SELECT id FROM pilot_grading.uploads")).rows,
  ).toHaveLength(1);
  await db.query(
    "UPDATE pilot_grading.uploads SET deleted_at=now() WHERE id=$1",
    [first.uploadId],
  );
  await expect(
    db.transaction((tx) => quota.reserve(tx, 41)),
  ).rejects.toMatchObject({ code: "storage_quota_exceeded" });
  await db.query(
    "UPDATE pilot_grading.uploads SET purged_at=now() WHERE id=$1",
    [first.uploadId],
  );
  await expect(
    db.transaction((tx) => quota.reserve(tx, 100)),
  ).resolves.toBeUndefined();
});
it("rejects invalid quota reservations without arithmetic overflow", async () => {
  const quota = new StorageQuota();
  for (const n of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])
    await expect(
      db.transaction((tx) => quota.reserve(tx, n)),
    ).rejects.toMatchObject({ code: "invalid_request" });
});
