import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../database.js";
import type { PrivateStorage } from "./storage.js";
import { PilotUploadService } from "./uploads.js";
import { PilotTaskRepository } from "./tasks.js";
import {
  command,
  ownerA,
  ownerB,
  pilotTestDb,
  validDraft,
} from "./testSupport.js";
const png = () =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
class StorageDouble implements PrivateStorage {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  calls = 0;
  async signUpload(path: string) {
    this.calls++;
    return {
      url: "https://storage.test/" + path,
      expiresAt: "2026-09-29T00:00:00Z",
    };
  }
  async read(path: string) {
    this.calls++;
    const object = this.objects.get(path);
    if (!object) throw Error("missing");
    return object;
  }
  async signRead(path: string) {
    this.calls++;
    return "https://storage.test/" + path + "?short";
  }
  async remove(paths: string[]) {
    this.calls++;
    for (const p of paths) this.objects.delete(p);
  }
}
let db: Database,
  repo: PilotTaskRepository,
  store: StorageDouble,
  uploads: PilotUploadService;
beforeAll(async () => {
  db = await pilotTestDb();
  repo = new PilotTaskRepository(db);
  store = new StorageDouble();
  uploads = new PilotUploadService(db, store);
});
afterAll(async () => {
  await db?.close();
});
async function task() {
  const d = await repo.createDraft(ownerA, command(validDraft()));
  return repo.confirm(ownerA, d.id, command({}, d.revision));
}
async function reserve(taskId: string) {
  return uploads.reserve(
    ownerA,
    taskId,
    command({
      purpose: "essay",
      mimeType: "image/png",
      size: png().length,
      label: "Page",
    }),
  );
}
function put(
  ticket: { url: string },
  bytes = png(),
  contentType = "image/png",
) {
  store.objects.set(new URL(ticket.url).pathname.slice(1), {
    bytes,
    contentType,
  });
}
describe("private uploads", () => {
  it("rejectsForeignUploadBeforeStorageAccess", async () => {
    const t = await task(),
      u = await reserve(t.id),
      n = store.calls;
    await expect(uploads.readUrl(ownerB, u.uploadId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      uploads.complete(ownerB, u.uploadId, command({})),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      uploads.loadVerified(ownerB, u.uploadId, new AbortController().signal),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(store.calls).toBe(n);
  });
  it("reusesUploadRegistrationAfterLostResponse", async () => {
    const t = await task(),
      c = command({
        purpose: "essay" as const,
        mimeType: "image/png" as const,
        size: png().length,
        label: "Page",
      });
    const a = await uploads.reserve(ownerA, t.id, c),
      b = await uploads.reserve(ownerA, t.id, c);
    expect(a.uploadId).toBe(b.uploadId);
    put(a);
    const commit = command({});
    const page = await uploads.complete(ownerA, a.uploadId, commit);
    expect(await uploads.complete(ownerA, b.uploadId, commit)).toEqual(page);
    const recovered = await new PilotUploadService(db, store).list(
      ownerA,
      t.id,
      {},
    );
    expect(recovered.items).toMatchObject([
      { id: a.uploadId, state: "verified" },
    ]);
    const receipts = (
      await db.query(
        "SELECT response FROM pilot_grading.command_receipts WHERE owner_id=$1",
        [ownerA],
      )
    ).rows;
    expect(JSON.stringify(receipts)).not.toContain("https://storage.test");
  });
  it("doesNotGradeIncompleteUpload", async () => {
    const t = await task(),
      u = await reserve(t.id);
    put(u);
    const n = store.calls;
    await expect(
      uploads.loadVerified(ownerA, u.uploadId, new AbortController().signal),
    ).rejects.toMatchObject({ code: "upload_incomplete" });
    expect(store.calls).toBe(n);
  });
  it("rejectsMimeSizeAndDigestMismatch", async () => {
    const t = await task();
    for (const [bytes, mime] of [
      [png(), "image/jpeg"],
      [Buffer.from("not an image"), "image/png"],
      [Buffer.concat([png(), Buffer.from("extra")]), "image/png"],
    ] as const) {
      const u = await reserve(t.id);
      put(u, bytes, mime);
      await expect(
        uploads.complete(ownerA, u.uploadId, command({})),
      ).rejects.toMatchObject({ code: "invalid_image" });
    }
  });
  it("rechecksBytesAfterSignedUploadReplay", async () => {
    const t = await task(),
      u = await reserve(t.id);
    put(u);
    await uploads.complete(ownerA, u.uploadId, command({}));
    expect(
      (
        await uploads.loadVerified(
          ownerA,
          u.uploadId,
          new AbortController().signal,
        )
      ).buffer,
    ).toEqual(png());
    const changed = png();
    changed[changed.length - 1] ^= 1;
    put(u, changed);
    await expect(
      uploads.loadVerified(ownerA, u.uploadId, new AbortController().signal),
    ).rejects.toMatchObject({ code: "image_changed" });
    await expect(
      uploads.complete(ownerA, u.uploadId, command({})),
    ).rejects.toMatchObject({ code: "image_changed" });
  });
  it("neverReadsDeletedTaskOrForeignMaterialReference", async () => {
    const t = await task(),
      u = await reserve(t.id);
    put(u);
    await uploads.complete(ownerA, u.uploadId, command({}));
    const b = await repo.createDraft(ownerB, command(validDraft()));
    await expect(
      repo.saveDraft(
        ownerB,
        b.id,
        command(
          {
            ...validDraft(),
            materialRefs: [{ kind: "image", uploadId: u.uploadId }],
          },
          b.revision,
        ),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await db.query(
      "UPDATE pilot_grading.tasks SET deleted_at=now() WHERE id=$1",
      [t.id],
    );
    const n = store.calls;
    await expect(uploads.readUrl(ownerA, u.uploadId)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(store.calls).toBe(n);
  });
  it("bindsVerifiedMaterialToOwnedDraftAndRejectsWrongPurpose", async () => {
    const draft = await repo.createDraft(ownerA, command(validDraft()));
    const u = await uploads.reserve(
      ownerA,
      draft.id,
      command({
        purpose: "material",
        mimeType: "image/png",
        size: png().length,
        label: "Material",
      }),
    );
    put(u);
    await uploads.complete(ownerA, u.uploadId, command({}));
    const saved = await repo.saveDraft(
      ownerA,
      draft.id,
      command(
        {
          ...validDraft(),
          materialRefs: [{ kind: "image", uploadId: u.uploadId }],
        },
        draft.revision,
      ),
    );
    expect(saved.draft.materialRefs).toEqual([
      { kind: "image", uploadId: u.uploadId },
    ]);
    expect((await uploads.list(ownerA, draft.id, {})).items[0].state).toBe(
      "attached",
    );
    await expect(
      uploads.reserve(
        ownerA,
        draft.id,
        command({
          purpose: "essay",
          mimeType: "image/png",
          size: png().length,
          label: "Wrong stage",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
