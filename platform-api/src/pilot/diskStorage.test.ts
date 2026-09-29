import {
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDiskStorage } from "./diskStorage.js";

const path =
  "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const minFree = 10 * 1024 ** 3;
const png = (() => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(2, 16);
  bytes.writeUInt32BE(3, 20);
  return bytes;
})();
const pieces = async function* (...bytes: Uint8Array[]) {
  for (const byte of bytes) yield byte;
};
async function fixture(freeBytes = minFree + 8 * 1024 ** 2) {
  const root = await mkdtemp(join(tmpdir(), "pilot-disk-test-"));
  const storage = createDiskStorage({
    root,
    origin: "https://example.test",
    signingKey: "x".repeat(32),
    freeBytes: async () => freeBytes,
  });
  return { root, storage };
}

describe("private disk storage", () => {
  it("rejects a root below the application's static build directory", () => {
    const staticRoot = resolve(
      process.cwd(),
      "..",
      "app",
      "dist",
      "private-images",
    );
    expect(() =>
      createDiskStorage({
        root: staticRoot,
        origin: "https://example.test",
        signingKey: "x".repeat(32),
      }),
    ).toThrow();
  });
  it("round trips original bytes and byte-derived MIME", async () => {
    const { storage } = await fixture();
    await storage.put(
      path,
      pieces(png.subarray(0, 9), png.subarray(9)),
      { size: png.length, contentType: "image/png" },
      new AbortController().signal,
    );
    const result = await storage.read(path, new AbortController().signal);
    expect(result.contentType).toBe("image/png");
    expect(Buffer.from(result.bytes)).toEqual(png);
    const ticket = await storage.signUpload(path);
    expect(new URL(ticket.url).pathname).toBe(`/api/pilot/files/${path}`);
    const readUrl = new URL(await storage.signRead(path, 60));
    expect(readUrl.pathname).toBe(`/api/pilot/files/${path}`);
    storage.verifyTicket(
      "GET",
      path,
      readUrl.searchParams.get("expires")!,
      readUrl.searchParams.get("signature")!,
    );
  });

  it("rejects overlong, short, MIME-mismatched and dimensionless streams without publishing", async () => {
    const { root, storage } = await fixture();
    const bad = [
      {
        data: [png, Buffer.from([1])],
        expected: { size: png.length, contentType: "image/png" },
      },
      {
        data: [png],
        expected: { size: png.length + 1, contentType: "image/png" },
      },
      {
        data: [png],
        expected: { size: png.length, contentType: "image/jpeg" },
      },
      {
        data: [Buffer.from("not image")],
        expected: { size: 9, contentType: "image/png" },
      },
    ];
    for (const item of bad) {
      await expect(
        storage.put(
          path,
          pieces(...item.data),
          item.expected,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "invalid_image" });
      expect(await readdir(join(root, path.split("/")[0]))).toEqual([]);
    }
  });

  it("stops at 8 MiB plus one byte and preserves an existing upload", async () => {
    const { root, storage } = await fixture();
    await storage.put(
      path,
      pieces(png),
      { size: png.length, contentType: "image/png" },
      new AbortController().signal,
    );
    let pulled = 0;
    async function* overflow() {
      for (const chunk of [
        png,
        Buffer.alloc(8 * 1024 ** 2),
        Buffer.from([1]),
      ]) {
        pulled++;
        yield chunk;
      }
      throw Error("stream should have stopped");
    }
    await expect(
      storage.put(
        path,
        overflow(),
        { size: 8 * 1024 ** 2, contentType: "image/png" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "invalid_image" });
    expect(pulled).toBe(2);
    expect(await readFile(join(root, path))).toEqual(png);
    expect(await readdir(join(root, path.split("/")[0]))).toEqual([
      path.split("/")[1],
    ]);
  });

  it("never overwrites a completed upload with a second valid body", async () => {
    const { root, storage } = await fixture();
    await storage.put(
      path,
      pieces(png),
      { size: png.length, contentType: "image/png" },
      new AbortController().signal,
    );
    const changed = Buffer.from(png);
    changed.writeUInt32BE(4, 16);
    await expect(
      storage.put(
        path,
        pieces(changed),
        { size: changed.length, contentType: "image/png" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "upload_exists", status: 409 });
    expect(await readFile(join(root, path))).toEqual(png);
    expect(await readdir(join(root, path.split("/")[0]))).toEqual([
      path.split("/")[1],
    ]);
  });

  it("cleans interrupted writes and rejects symlink path components", async () => {
    const { root, storage } = await fixture();
    async function* interrupted() {
      yield png.subarray(0, 8);
      throw Error("interrupted");
    }
    await expect(
      storage.put(
        path,
        interrupted(),
        { size: png.length, contentType: "image/png" },
        new AbortController().signal,
      ),
    ).rejects.toBeDefined();
    expect(await readdir(join(root, path.split("/")[0]))).toEqual([]);
    const outside = await mkdtemp(join(tmpdir(), "pilot-outside-"));
    const symlinkPath = `33333333-3333-4333-8333-333333333333/${path.split("/")[1]}`;
    await symlink(outside, join(root, symlinkPath.split("/")[0]), "junction");
    await expect(
      storage.put(
        symlinkPath,
        pieces(png),
        { size: png.length, contentType: "image/png" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await readdir(outside)).toEqual([]);
    await writeFile(join(outside, "sentinel"), "safe");
    await expect(
      storage.read(symlinkPath, new AbortController().signal),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("safe");
  });

  it("requires ten GiB after accounting for incoming bytes", async () => {
    const { storage } = await fixture(minFree + png.length - 1);
    await expect(
      storage.put(
        path,
        pieces(png),
        { size: png.length, contentType: "image/png" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
  });

  it("reserves free space for an upload still in progress", async () => {
    const { storage } = await fixture(minFree + png.length * 2 - 1);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* slow() {
      entered();
      await gate;
      yield png;
    }
    const first = storage.put(
      path,
      slow(),
      { size: png.length, contentType: "image/png" },
      new AbortController().signal,
    );
    await started;
    const other = `11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333`;
    await expect(
      storage.put(
        other,
        pieces(png),
        { size: png.length, contentType: "image/png" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    release();
    await first;
  });

  it("removes valid objects idempotently and rejects invalid private paths", async () => {
    const { root, storage } = await fixture();
    await storage.put(
      path,
      pieces(png),
      { size: png.length, contentType: "image/png" },
      new AbortController().signal,
    );
    await storage.remove([path]);
    await storage.remove([path]);
    expect(await readdir(join(root, path.split("/")[0]))).toEqual([]);
    await expect(storage.remove(["../outside"])).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("removes a partial temporary file after cancellation", async () => {
    const { root, storage } = await fixture();
    const controller = new AbortController();
    async function* cancelled() {
      yield png.subarray(0, 8);
      controller.abort();
      yield png.subarray(8);
    }
    await expect(
      storage.put(
        path,
        cancelled(),
        { size: png.length, contentType: "image/png" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(await readdir(join(root, path.split("/")[0]))).toEqual([]);
  });

  it("refuses a symlink at the final file name", async () => {
    const { root, storage } = await fixture();
    await storage.put(
      path,
      pieces(png),
      { size: png.length, contentType: "image/png" },
      new AbortController().signal,
    );
    const outside = await mkdtemp(join(tmpdir(), "pilot-file-outside-"));
    const other = `11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333`;
    await writeFile(join(outside, "image"), png);
    await symlink(outside, join(root, other), "junction");
    await expect(
      storage.read(other, new AbortController().signal),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.remove([other])).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await readFile(join(outside, "image"))).toEqual(png);
  });
});
