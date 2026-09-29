import request from "supertest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createApp } from "../server.js";
import { createDiskStorage, type DiskStorage } from "./diskStorage.js";
import { workerFixture } from "./workerTestSupport.js";
import { httpFixture } from "./httpTestSupport.js";
import { PilotTaskRepository } from "./tasks.js";
import { PilotUploadService } from "./uploads.js";
import { PilotCleanupService } from "./cleanup.js";
import { createFileRouter } from "./fileRoutes.js";
import { command, ownerA, validDraft } from "./testSupport.js";
import type { MigrationGate } from "./migrationGate.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
let f: Awaited<ReturnType<typeof httpFixture>>,
  sample: Awaited<ReturnType<typeof workerFixture>>,
  root: string,
  storage: DiskStorage,
  uploads: PilotUploadService;
let frozen = false,
  active = 0;
const gate: MigrationGate = {
  assertOpen: async () => {},
  guardDatabase: (db) => db,
  run: async (op) => {
    if (frozen) throw Object.assign(Error(), { status: 503 });
    active++;
    try {
      return await op();
    } finally {
      active--;
    }
  },
};
function app(store = storage) {
  return createApp(f.repo, f.config, undefined, {
    migrationGate: gate,
    pilotRuntime: {
      ...sample.deps,
      db: f.db,
      storage: store,
      diskStorage: store,
      migrationGate: gate,
      uploads: new PilotUploadService(f.db, store),
    },
  });
}
beforeAll(async () => {
  f = await httpFixture();
  sample = await workerFixture(f.db);
  root = await mkdtemp(join(tmpdir(), "pilot-http-"));
  storage = createDiskStorage({
    root,
    origin: f.config.origin,
    signingKey: "synthetic-key-".repeat(4),
    freeBytes: async () => 30 * 1024 ** 3,
  });
  uploads = new PilotUploadService(f.db, storage);
});
afterAll(async () => {
  await f?.db.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function reserve() {
  const t = await new PilotTaskRepository(f.db).createDraft(
    ownerA,
    command(validDraft()),
  );
  return uploads.reserve(
    ownerA,
    t.id,
    command({
      purpose: "material",
      mimeType: "image/png",
      size: png.length,
      label: "synthetic",
    }),
  );
}
const route = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};
function put(a: ReturnType<typeof app>, url: string, index = 0) {
  const s = f.sessions[index];
  return request(a)
    .put(route(url))
    .set("Cookie", s.cookie)
    .set("Origin", f.config.origin)
    .set("X-CSRF-Token", s.csrf)
    .set("Content-Type", "image/png");
}
it("requires teacher session, Origin, CSRF and owner even with a valid ticket", async () => {
  const u = await reserve(),
    a = app(),
    s = f.sessions[0];
  expect(
    (
      await request(a)
        .put(route(u.url))
        .set("Origin", f.config.origin)
        .send(png)
    ).status,
  ).toBe(401);
  expect((await put(a, u.url, 1).send(png)).status).toBe(404);
  expect((await put(a, u.url, 2).send(png)).status).toBe(403);
  expect(
    (await put(a, u.url).set("Origin", "https://evil.test").send(png)).status,
  ).toBe(403);
  expect(
    (
      await request(a)
        .put(route(u.url))
        .set("Cookie", s.cookie)
        .set("Origin", f.config.origin)
        .send(png)
    ).status,
  ).toBe(403);
  expect((await put(a, u.url).send(png)).status).toBe(201);
});
it("preserves immutable original bytes through duplicate PUT, completion and authenticated verified GET", async () => {
  const u = await reserve(),
    a = app();
  expect(
    (
      await request(a)
        .get(
          route(
            await storage.signRead(
              new URL(u.url).pathname.split("/").slice(-2).join("/"),
              60,
            ),
          ),
        )
        .set("Cookie", f.sessions[0].cookie)
    ).status,
  ).toBe(409);
  expect((await put(a, u.url).send(png)).status).toBe(201);
  expect((await put(a, u.url).send(png)).status).toBe(409);
  await uploads.complete(ownerA, u.uploadId, command({}));
  const signed = await uploads.readUrl(ownerA, u.uploadId);
  const read = await request(a)
    .get(route(signed.url))
    .set("Cookie", f.sessions[0].cookie);
  expect(read.status).toBe(200);
  expect(read.body).toEqual(png);
  expect(read.headers["cache-control"]).toContain("no-store");
  expect(read.headers["x-content-type-options"]).toBe("nosniff");
  expect(
    (
      await request(a)
        .get(route(signed.url))
        .set("Cookie", f.sessions[1].cookie)
    ).status,
  ).toBe(404);
  expect((await request(a).get(route(signed.url))).status).toBe(401);
  expect(
    (await request(a).get(route(u.url)).set("Cookie", f.sessions[0].cookie))
      .status,
  ).toBe(403);
  expect(
    (await put(a, u.url.replace(/expires=\d+/, "expires=1")).send(png)).status,
  ).toBe(403);
  const other = f.sessions[1];
  expect(
    (
      await request(createApp(f.repo, f.config))
        .post("/api/auth/logout")
        .set("Cookie", other.cookie)
        .set("Origin", f.config.origin)
        .set("X-CSRF-Token", other.csrf)
    ).status,
  ).toBe(204);
  expect(
    (await request(a).get(route(signed.url)).set("Cookie", other.cookie))
      .status,
  ).toBe(401);
});
it("aborted HTTP streams settle storage and release admission without publishing a partial file", async () => {
  const u = await reserve();
  let entered = false,
    settled = false;
  const a = app({
    ...storage,
    put: async (...args) => {
      entered = true;
      try {
        await storage.put(...args);
      } finally {
        settled = true;
      }
    },
  });
  const server = a.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  const s = f.sessions[0];
  const req = httpRequest({
    host: "127.0.0.1",
    port: address.port,
    path: route(u.url),
    method: "PUT",
    headers: {
      Cookie: s.cookie,
      Origin: f.config.origin,
      "X-CSRF-Token": s.csrf,
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
    },
  });
  req.on("error", () => {});
  req.write(png.subarray(0, 20));
  try {
    for (let i = 0; i < 100 && !entered; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(entered).toBe(true);
    expect(active).toBe(1);
    req.destroy();
    for (let i = 0; i < 100 && !settled; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(true);
    expect(active).toBe(0);
    const path = new URL(u.url).pathname.split("/").slice(-2).join("/");
    await expect(
      storage.read(path, new AbortController().signal),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect((await put(a, u.url).send(png)).status).toBe(201);
  } finally {
    req.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
it("keeps a PUT ahead of task deletion until its file is published", async () => {
  const u = await reserve();
  const upload = (
    await f.db.query<{ task_id: string }>(
      "SELECT task_id FROM pilot_grading.uploads WHERE id=$1",
      [u.uploadId],
    )
  ).rows[0];
  const task = (
    await f.db.query<{ revision: number }>(
      "SELECT revision FROM pilot_grading.tasks WHERE id=$1",
      [upload.task_id],
    )
  ).rows[0];
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => (entered = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  const a = app({
    ...storage,
    put: async (...args) => {
      entered();
      await held;
      await storage.put(...args);
    },
  });
  const uploadRequest = put(a, u.url)
    .send(png)
    .then((response) => response);
  let deletionSettled = false;
  let deletion: Promise<void> | undefined;
  try {
    await waiting;
    deletion = new PilotCleanupService(f.db, storage)
      .deleteTask(ownerA, upload.task_id, command({}, task.revision))
      .finally(() => {
        deletionSettled = true;
      });
    await Promise.race([
      deletion,
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);
    expect(deletionSettled).toBe(false);
  } finally {
    release();
    await uploadRequest;
    await deletion;
  }
  const path = new URL(u.url).pathname.split("/").slice(-2).join("/");
  expect(
    (await storage.read(path, new AbortController().signal)).bytes,
  ).toEqual(png);
  await f.db.query(
    "UPDATE pilot_grading.uploads SET last_signed_at=now()-interval '3 hours' WHERE id=$1",
    [u.uploadId],
  );
  expect(
    await new PilotCleanupService(f.db, storage).runBatch(50, ownerA),
  ).toBe(1);
  await expect(
    storage.read(path, new AbortController().signal),
  ).rejects.toMatchObject({ code: "storage_unavailable" });
  expect(
    (
      await f.db.query<{ purged: boolean }>(
        "SELECT purged_at IS NOT NULL AS purged FROM pilot_grading.uploads WHERE id=$1",
        [u.uploadId],
      )
    ).rows[0].purged,
  ).toBe(true);
});
it("rejects invalid dimensions, metadata and disabled accounts; failed PUT frees limiter", async () => {
  const u = await reserve(),
    a = app();
  expect(
    (await put(a, u.url).set("Content-Type", "image/jpeg").send(png)).status,
  ).toBe(400);
  const bad = Buffer.from(png);
  bad.writeUInt32BE(0, 16);
  expect((await put(a, u.url).send(bad)).status).toBe(400);
  expect((await put(a, u.url).send(png)).status).toBe(201);
  await uploads.complete(ownerA, u.uploadId, command({}));
  const signed = await uploads.readUrl(ownerA, u.uploadId);
  await f.db.query(
    "UPDATE pilot_auth.accounts SET status='disabled' WHERE id=$1",
    [ownerA],
  );
  expect((await put(a, u.url).send(png)).status).toBe(401);
  expect(
    (
      await request(a)
        .get(route(signed.url))
        .set("Cookie", f.sessions[0].cookie)
    ).status,
  ).toBe(401);
  await f.db.query(
    "UPDATE pilot_auth.accounts SET status='active' WHERE id=$1",
    [ownerA],
  );
  // A fresh session is required after disabling an account invalidates existing ones.
  expect(active).toBe(0);
});
it("limits simultaneous PUT to two and keeps admission until pending storage settles", async () => {
  // Refresh fixture after the deliberate session revocation above.
  await f.db.close();
  f = await httpFixture();
  uploads = new PilotUploadService(f.db, storage);
  const tickets = await Promise.all([reserve(), reserve(), reserve()]);
  let releases: (() => void)[] = [];
  const slow: DiskStorage = {
    ...storage,
    put: async () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  };
  // Mount the file router directly so PGlite's single transaction does not
  // stall unrelated session middleware before the third request reaches it.
  const a = express();
  a.use((_req, res, next) => {
    res.locals.user = { id: ownerA };
    next();
  });
  a.use("/api/pilot", createFileRouter({ db: f.db, storage: slow, gate }));
  a.use((error: unknown, _req: Request, res: Response, _next: NextFunction) =>
    res.status((error as { status?: number }).status ?? 500).end(),
  );
  const first = put(a, tickets[0].url)
    .send(png)
    .then((r) => r);
  for (let i = 0; i < 100 && releases.length < 1; i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(releases).toHaveLength(1);
  const second = put(a, tickets[1].url)
    .send(png)
    .then((r) => r);
  // The local PGlite fixture runs transactions serially, so the second
  // admitted request waits for the first transaction before entering put.
  for (let i = 0; i < 100 && active < 2; i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(active).toBe(2);
  expect((await put(a, tickets[2].url).send(png)).status).toBe(503);
  frozen = true;
  expect((await put(a, tickets[2].url).send(png)).status).toBe(503);
  releases[0]();
  expect((await first).status).toBe(201);
  for (let i = 0; i < 100 && releases.length < 2; i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(releases).toHaveLength(2);
  releases[1]();
  expect((await second).status).toBe(201);
  expect(active).toBe(0);
  frozen = false;
});
