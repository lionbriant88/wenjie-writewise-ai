import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";
import type { Database } from "../src/database.js";
import { hashPassword } from "../src/crypto.js";
import { AuthRepository } from "../src/repository.js";
import { createApp } from "../src/server.js";
import { createMigrationGate } from "../src/pilot/migrationGate.js";
import {
  createDiskStorage,
  type DiskStorage,
} from "../src/pilot/diskStorage.js";
import { createPostgresQueue } from "../src/pilot/postgresQueue.js";
import { StorageQuota } from "../src/pilot/storageQuota.js";
import { PilotUploadService } from "../src/pilot/uploads.js";
import { PilotCleanupService } from "../src/pilot/cleanup.js";
import { createStandaloneWorker } from "../src/standalone/worker.js";
import { syntheticImage, syntheticProvider } from "./verifyPilotLocal.js";
import { validDraft, command } from "../src/pilot/testSupport.js";
import { controlMigration } from "./migrationControl.js";
import type { AuthConfig } from "../src/config.js";
import type {
  EssayDto,
  TaskDto,
  UploadTicket,
} from "../../shared/pilotContracts.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function settleAdmissions(admin: Database) {
  for (let i = 0; i < 200; i++) {
    if (
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM pilot_grading.migration_admissions",
        )
      ).rows[0].n === 0
    )
      return;
    await delay(10);
  }
  throw Error("http_admission_did_not_settle");
}
async function authFingerprint(admin: Database) {
  return (
    await admin.query(
      "SELECT md5(row_to_json(s)::text) AS hash FROM (SELECT (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM pilot_auth.accounts a) accounts,(SELECT jsonb_agg(to_jsonb(s) ORDER BY token_hash) FROM pilot_auth.sessions s) sessions,(SELECT jsonb_agg(to_jsonb(r) ORDER BY bucket) FROM pilot_auth.rate_limits r) limits,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM pilot_auth.audit a) audit) s",
    )
  ).rows[0].hash;
}

/** Called only after the parent verifier proved a fresh local disposable DB. */
export async function verifyStandaloneHttp(
  a: Database,
  b: Database,
  admin: Database,
) {
  const password = randomBytes(24).toString("hex"),
    passwordHash = await hashPassword(password);
  const accounts = Array.from({ length: 3 }, (_, i) => ({
    id: randomUUID(),
    username: "wj_" + randomBytes(12).toString("hex"),
    role: i === 2 ? "admin" : "teacher",
  }));
  for (const account of accounts)
    await admin.query(
      "INSERT INTO pilot_auth.accounts(id,batch_id,username,display_name,role,password_hash) VALUES($1,'teacher-pilot-v1',$2,'Synthetic HTTP',$3,$4)",
      [account.id, account.username, account.role, passwordHash],
    );
  const config: AuthConfig = {
    origin: "https://school.example",
    secret: randomBytes(32).toString("hex"),
    secure: true,
    cookieName: "__Host-wj_session",
    trustedVercel: false,
    storage: "postgres",
  };
  const root = resolve(
    "local-private-accounts/tencent-migration/standalone-http-files",
    randomUUID(),
  );
  await mkdir(root, { recursive: true });
  const disk = createDiskStorage({
    root,
    origin: config.origin,
    signingKey: randomBytes(32).toString("hex"),
  });
  const gate = createMigrationGate(a),
    db = gate.guardDatabase(a),
    imageCounts: number[] = [];
  let blockPut:
    | {
        entered: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;
  const storage: DiskStorage = {
    ...disk,
    async put(...args) {
      const block = blockPut;
      if (block) {
        block.entered.resolve();
        await block.release.promise;
      }
      return disk.put(...args);
    },
  };
  const postgresQueue = createPostgresQueue(db),
    runtime = {
      db,
      storage,
      diskStorage: storage,
      postgresQueue,
      queue: postgresQueue,
      migrationGate: gate,
      uploads: new PilotUploadService(db, storage, new StorageQuota()),
      provider: syntheticProvider(imageCounts),
    };
  let app = createApp(new AuthRepository(db), config, undefined, {
    pilotRuntime: runtime,
    migrationGate: gate,
  });
  async function login(i: number) {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", config.origin)
      .send({ username: accounts[i].username, password });
    assert.equal(response.status, 200, "http_login");
    return {
      cookie: response.headers["set-cookie"][0].split(";")[0],
      csrf: String(response.body.csrfToken),
    };
  }
  let teacher = await login(0);
  const other = await login(1),
    administrator = await login(2);
  const call = (
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
    body?: unknown,
    who = teacher,
  ) => {
    const op = request(app)[method](path).set("Cookie", who.cookie);
    if (method !== "get")
      op.set("Origin", config.origin).set("X-CSRF-Token", who.csrf);
    return body === undefined ? op : op.send(body as object);
  };
  const draftResponse = await call(
    "post",
    "/api/pilot/tasks",
    command(validDraft()),
  );
  assert.equal(draftResponse.status, 201);
  const draft = draftResponse.body as TaskDto;
  const confirm = await call(
    "post",
    `/api/pilot/tasks/${draft.id}/confirm`,
    command({}, draft.revision),
  );
  assert.equal(confirm.status, 200);
  const task = confirm.body as TaskDto;
  const reserve = async () => {
    const response = await call(
      "post",
      `/api/pilot/tasks/${task.id}/uploads`,
      command({
        purpose: "essay",
        mimeType: "image/png",
        size: syntheticImage.length,
        label: "Synthetic",
      }),
    );
    assert.equal(response.status, 201);
    return response.body as UploadTicket;
  };
  const ticket = await reserve();
  const uploadUrl = new URL(ticket.url),
    url = uploadUrl.pathname + uploadUrl.search;
  assert.equal(
    (
      await call("put", url, undefined, other)
        .set("Content-Type", "image/png")
        .send(syntheticImage)
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .put(url)
        .set("Cookie", teacher.cookie)
        .set("Origin", config.origin)
        .set("Content-Type", "image/png")
        .send(syntheticImage)
    ).status,
    403,
  );
  blockPut = { entered: deferred(), release: deferred() };
  const activePut = call("put", url)
    .set("Content-Type", "image/png")
    .send(syntheticImage)
    .then((r) => r);
  await blockPut.entered.promise;
  assert.equal(
    (await controlMigration(admin, "freeze")).state,
    "waiting_operations",
  );
  blockPut.release.resolve();
  assert.equal((await activePut).status, 201);
  blockPut = undefined;
  await settleAdmissions(admin);
  assert.equal(
    (await controlMigration(admin, "freeze")).state,
    "waiting_upload_expiry",
  );
  const before = await authFingerprint(admin);
  for (const [method, path, body, who] of [
    ["get", "/api/auth/session", undefined, teacher],
    [
      "post",
      "/api/auth/login",
      { username: accounts[0].username, password },
      teacher,
    ],
    ["post", "/api/auth/logout", undefined, teacher],
    ["get", "/api/admin/accounts", undefined, administrator],
    [
      "patch",
      `/api/admin/accounts/${accounts[0].id}`,
      { displayName: "Must not change" },
      administrator,
    ],
    ["get", "/api/pilot/tasks", undefined, teacher],
    [
      "post",
      `/api/pilot/uploads/${ticket.uploadId}/complete`,
      command({}),
      teacher,
    ],
    ["put", url, undefined, teacher],
  ] as const)
    assert.equal(
      (await call(method, path, body, who)).status,
      503,
      "frozen_http_path",
    );
  assert.equal(
    await authFingerprint(admin),
    before,
    "frozen_auth_has_zero_implicit_writes",
  );
  assert.equal((await controlMigration(admin, "thaw")).state, "open");
  assert.equal(
    (
      await call(
        "post",
        `/api/pilot/uploads/${ticket.uploadId}/complete`,
        command({}),
      )
    ).status,
    200,
  );
  const signed = await call(
    "get",
    `/api/pilot/uploads/${ticket.uploadId}/read-url`,
  );
  assert.equal(signed.status, 200);
  const readUrl = new URL(signed.body.url),
    readPath = readUrl.pathname + readUrl.search;
  const read = await call("get", readPath);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, syntheticImage);
  assert.equal((await call("get", readPath, undefined, other)).status, 404);
  assert.equal(
    (
      await call("put", url)
        .set("Content-Type", "image/png")
        .send(syntheticImage)
    ).status,
    409,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT sha256 FROM pilot_grading.uploads WHERE id=$1",
        [ticket.uploadId],
      )
    ).rows[0].sha256,
    createHash("sha256").update(syntheticImage).digest("hex"),
  );
  await controlMigration(admin, "freeze");
  assert.equal((await call("get", readPath)).status, 503);
  await controlMigration(admin, "thaw");

  // A real socket abort must retain the admission until the put operation
  // observes cancellation and settles, even though the response is closed.
  const abortTicket = await reserve(),
    abortUrl = new URL(abortTicket.url);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  blockPut = { entered: deferred(), release: deferred() };
  const client = httpRequest({
    hostname: "127.0.0.1",
    port: address.port,
    path: abortUrl.pathname + abortUrl.search,
    method: "PUT",
    headers: {
      Cookie: teacher.cookie,
      Origin: config.origin,
      "X-CSRF-Token": teacher.csrf,
      "Content-Type": "image/png",
      "Content-Length": syntheticImage.length,
    },
  });
  client.on("error", () => {});
  client.write(syntheticImage.subarray(0, 12));
  try {
    await blockPut.entered.promise;
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_operations",
    );
    client.destroy();
    await delay(20);
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_operations",
    );
    blockPut.release.resolve();
    blockPut = undefined;
    await settleAdmissions(admin);
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_upload_expiry",
    );
    const path = (
      await admin.query<{ path: string }>(
        "SELECT path FROM pilot_grading.uploads WHERE id=$1",
        [abortTicket.uploadId],
      )
    ).rows[0].path;
    await assert.rejects(disk.read(path, new AbortController().signal));
    await controlMigration(admin, "thaw");
  } finally {
    client.destroy();
    blockPut?.release.resolve();
    blockPut = undefined;
    await new Promise<void>((done, error) =>
      server.close((e) => (e ? error(e) : done())),
    );
  }

  const attached = await call(
    "post",
    `/api/pilot/tasks/${task.id}/essays`,
    command({ groups: [{ studentName: "", uploadIds: [ticket.uploadId] }] }),
  );
  assert.equal(attached.status, 201);
  assert.equal(
    (await call("post", `/api/pilot/tasks/${task.id}/grade`, command({}))).body
      .accepted,
    1,
  );
  assert.equal(
    (await call("post", `/api/pilot/tasks/${task.id}/grade`, command({}))).body
      .accepted,
    0,
  );
  const worker = createStandaloneWorker(runtime);
  assert.equal(await worker.tick(), true);
  await worker.stop();
  const essay = (await call("get", `/api/pilot/tasks/${task.id}/essays`)).body
    .items[0] as EssayDto;
  assert.equal(essay.currentResult?.ai.resultVersion, "grading-result-v2");
  assert.deepEqual(imageCounts, [1]);
  const review = {
    dimensionScores: task.confirmedPackage!.rubric.dimensions.map((d) => ({
      dimensionId: d.id,
      score: (task.confirmedPackage!.fullScore * d.weight) / 100,
    })),
    overallComment: "Persisted synthetic teacher edit.",
    teacherSuggestion: "Keep practising.",
    confirm: true,
  };
  assert.equal(
    (
      await call(
        "put",
        `/api/pilot/essays/${essay.id}/review`,
        command(review, essay.revision),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "put",
        `/api/pilot/essays/${essay.id}/review`,
        command(review, essay.revision),
      )
    ).status,
    409,
  );
  assert.equal((await call("post", "/api/auth/logout")).status, 204);
  assert.equal((await call("get", "/api/auth/session")).status, 401);
  // Recreate the application and pool-backed services; durable rows and disk
  // bytes must recover independently of the original application instance.
  const gateB = createMigrationGate(b),
    dbB = gateB.guardDatabase(b),
    queueB = createPostgresQueue(dbB),
    runtimeB = {
      ...runtime,
      db: dbB,
      queue: queueB,
      postgresQueue: queueB,
      migrationGate: gateB,
      uploads: new PilotUploadService(dbB, storage, new StorageQuota()),
    };
  app = createApp(new AuthRepository(dbB), config, undefined, {
    pilotRuntime: runtimeB,
    migrationGate: gateB,
  });
  teacher = await login(0);
  const restored = await call("get", `/api/pilot/essays/${essay.id}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.teacherReviewed, true);
  assert.equal(
    restored.body.currentResult.review.overallComment,
    review.overallComment,
  );
  assert.deepEqual((await call("get", readPath)).body, syntheticImage);
  assert.equal(
    (await call("get", `/api/pilot/essays/${essay.id}`, undefined, other))
      .status,
    404,
  );
  const restartedWorker = createStandaloneWorker(runtimeB);
  assert.equal(await restartedWorker.tick(), false);
  await restartedWorker.stop();
  assert.deepEqual(imageCounts, [1]);

  // Keep all prior retained bytes in the quota sum. Two separate connections
  // race for capacity sufficient for precisely one new reservation.
  const total = Number(
    (
      await admin.query(
        "SELECT COALESCE(SUM(size),0)::text AS n FROM pilot_grading.uploads WHERE purged_at IS NULL",
      )
    ).rows[0].n,
  );
  const quota = new StorageQuota(total + syntheticImage.length);
  const uploadA = new PilotUploadService(db, storage, quota),
    uploadB = new PilotUploadService(dbB, storage, quota);
  const reservation = () =>
    command({
      purpose: "essay" as const,
      mimeType: "image/png" as const,
      size: syntheticImage.length,
      label: "Quota race",
    });
  const outcomes = await Promise.allSettled([
    uploadA.reserve(accounts[0].id, task.id, reservation()),
    uploadB.reserve(accounts[0].id, task.id, reservation()),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  const rejected = outcomes.find((r) => r.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.equal(rejected.reason.code, "storage_quota_exceeded");
  const deleteDraft = (
    await call("post", "/api/pilot/tasks", command(validDraft()))
  ).body as TaskDto;
  const deleteTask = (
    await call(
      "post",
      `/api/pilot/tasks/${deleteDraft.id}/confirm`,
      command({}, deleteDraft.revision),
    )
  ).body as TaskDto;
  const deleteTicketResponse = await call(
    "post",
    `/api/pilot/tasks/${deleteTask.id}/uploads`,
    reservation(),
  );
  assert.equal(deleteTicketResponse.status, 201);
  const deleteTicket = deleteTicketResponse.body as UploadTicket,
    deleteUrl = new URL(deleteTicket.url);
  blockPut = { entered: deferred(), release: deferred() };
  const pendingPut = call("put", deleteUrl.pathname + deleteUrl.search)
    .set("Content-Type", "image/png")
    .send(syntheticImage)
    .then((r) => r);
  await blockPut.entered.promise;
  let deletionFinished = false;
  const deletion = new PilotCleanupService(db, storage)
    .deleteTask(accounts[0].id, deleteTask.id, command({}, deleteTask.revision))
    .then(() => {
      deletionFinished = true;
    });
  try {
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      blocked =
        Number(
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE pilot_grading.uploads%'",
            )
          ).rows[0].n,
        ) > 0;
      if (blocked) break;
      await delay(10);
    }
    assert.equal(blocked, true, "delete_waits_on_real_upload_row_lock");
    assert.equal(deletionFinished, false);
  } finally {
    blockPut.release.resolve();
    blockPut = undefined;
  }
  assert.equal((await pendingPut).status, 201);
  await deletion;
  await admin.query(
    "UPDATE pilot_grading.uploads SET last_signed_at=now()-interval '3 hours' WHERE id=$1",
    [deleteTicket.uploadId],
  );
  assert.equal(
    await new PilotCleanupService(db, storage).runBatch(50, accounts[0].id),
    1,
  );
  const deletedUpload = (
    await admin.query<{ path: string; purged: boolean }>(
      "SELECT path,purged_at IS NOT NULL AS purged FROM pilot_grading.uploads WHERE id=$1",
      [deleteTicket.uploadId],
    )
  ).rows[0];
  assert.equal(deletedUpload.purged, true);
  await assert.rejects(
    disk.read(deletedUpload.path, new AbortController().signal),
  );
  for (const who of [teacher, other, administrator])
    assert.equal(
      (await call("post", "/api/auth/logout", undefined, who)).status,
      204,
    );
  return {
    passed: true,
    fakeProviderCalls: imageCounts.length,
    realModelCalls: 0,
    retainedImageHashes: 1,
    syntheticAccounts: 3,
    httpFreezePaths: 9,
    abortedSocketDrained: true,
    restartPersistence: true,
    teacherIsolation: true,
    quotaRaceAccepted: 1,
    quotaRaceRejected: 1,
    deleteWaitsForPutBeforePurge: true,
  };
}
