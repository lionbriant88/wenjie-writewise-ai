import request from "supertest";
import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { createLocalDatabase } from "./localDatabase.js";
import { migrate } from "./migrate.js";
import {
  buildManifest,
  applyManifest,
  type Manifest,
} from "../scripts/manifest.js";
import { AuthRepository } from "./repository.js";
import { createApp } from "./server.js";
import type { AuthConfig } from "./config.js";
import { digest, keyedDigest } from "./crypto.js";
const db = createLocalDatabase(),
  repo = new AuthRepository(db),
  password = randomBytes(20).toString("hex");
const origin = "https://school.example";
const config: AuthConfig = {
  origin,
  secret: "synthetic-secret-for-http-tests-".repeat(2),
  secure: true,
  cookieName: "__Host-wj_session",
  trustedVercel: false,
  storage: "local",
};
let manifest: Manifest, teacher: string, admin: string, teacherId: string;
let now = new Date("2026-09-13T00:00:00Z");
const app = () => createApp(repo, config, () => now);
const login = (username = teacher, pw = password) =>
  request(app())
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username, password: pw });
const cookie = (response: request.Response) =>
  response.headers["set-cookie"][0].split(";")[0];
beforeAll(async () => {
  await migrate(db);
  manifest = await buildManifest(password);
  await applyManifest(db, manifest);
  teacher = manifest.accounts[0].username;
  teacherId = manifest.accounts[0].id;
  admin = manifest.accounts[30].username;
});
beforeEach(async () => {
  await db.exec(
    "RESET ROLE; DELETE FROM pilot_auth.sessions; DELETE FROM pilot_auth.rate_limits; DELETE FROM pilot_auth.audit; UPDATE pilot_auth.accounts SET status='active'; SET ROLE wj_auth_runtime;",
  );
  now = new Date("2026-09-13T00:00:00Z");
});
afterAll(() => db.close());
it("authenticates with secure opaque cookies and only public user fields", async () => {
  const res = await login();
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({
    username: teacher,
    role: "teacher",
    status: "active",
  });
  expect(Object.keys(res.body.user).sort()).toEqual([
    "displayName",
    "id",
    "lastLoginAt",
    "role",
    "status",
    "username",
  ]);
  expect(res.headers["set-cookie"][0]).toMatch(
    /^__Host-wj_session=[A-Za-z0-9_-]{43};/,
  );
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
    expect(res.headers["set-cookie"][0]).toContain(flag);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(JSON.stringify(res.body)).not.toContain(password);
  const rows = (await db.query("SELECT token_hash FROM pilot_auth.sessions"))
    .rows;
  expect(rows).toHaveLength(1);
  expect(cookie(res)).not.toContain(rows[0].token_hash);
});
it("generic login failure covers incorrect, unknown and disabled accounts", async () => {
  const wrong = await login(teacher, "wrong");
  expect(wrong.status).toBe(401);
  expect((await login("wj_" + "f".repeat(24))).body).toEqual(wrong.body);
  await db.query(
    "UPDATE pilot_auth.accounts SET status='disabled' WHERE id=$1",
    [teacherId],
  );
  expect((await login()).body).toEqual(wrong.body);
});
it("durable session is replayable in a new app instance and revokes on logout", async () => {
  const res = await login();
  const c = cookie(res);
  const replay = await request(app()).get("/api/auth/session").set("Cookie", c);
  expect(replay.status).toBe(200);
  expect(replay.body.csrfToken).toBe(res.body.csrfToken);
  expect(
    (
      await request(app())
        .post("/api/auth/logout")
        .set("Origin", origin)
        .set("Cookie", c)
        .set("X-CSRF-Token", res.body.csrfToken)
    ).status,
  ).toBe(204);
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", c)).status,
  ).toBe(401);
});
it("rejects missing or forged Origin and CSRF before authenticated mutations", async () => {
  expect(
    (
      await request(app())
        .post("/api/auth/login")
        .send({ username: teacher, password })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post("/api/auth/login")
        .set("Origin", "https://attacker.example")
        .send({ username: teacher, password })
    ).status,
  ).toBe(403);
  const res = await login();
  expect(
    (
      await request(app())
        .post("/api/auth/logout")
        .set("Cookie", cookie(res))
        .set("Origin", origin)
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app())
        .post("/api/auth/logout")
        .set("Cookie", cookie(res))
        .set("Origin", "https://attacker.example")
        .set("X-CSRF-Token", res.body.csrfToken)
    ).status,
  ).toBe(403);
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", cookie(res)))
      .status,
  ).toBe(200);
});
it("rejects change/reset/register routes and rejects extra account fields", async () => {
  for (const path of ["change-password", "reset-password", "register"]) {
    const res = await request(app())
      .post("/api/auth/" + path)
      .set("Origin", origin)
      .send({ password: "replacement" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("operation_not_allowed");
  }
  const res = await login(admin);
  for (const data of [
    { password: "replacement" },
    { passwordHash: "replacement" },
    { role: "admin" },
    { displayName: "" },
    { status: "unknown" },
  ])
    expect(
      (
        await request(app())
          .patch("/api/admin/accounts/" + teacherId)
          .set("Cookie", cookie(res))
          .set("Origin", origin)
          .set("X-CSRF-Token", res.body.csrfToken)
          .send(data)
      ).status,
    ).toBe(400);
});
it("hides account directory from teachers and unauthenticated callers", async () => {
  expect((await request(app()).get("/api/admin/accounts")).status).toBe(401);
  const res = await login();
  expect(
    (await request(app()).get("/api/admin/accounts").set("Cookie", cookie(res)))
      .status,
  ).toBe(403);
  const a = await login(admin);
  const list = await request(app())
    .get("/api/admin/accounts")
    .set("Cookie", cookie(a));
  expect(list.status).toBe(200);
  expect(list.body.accounts).toHaveLength(31);
  expect(JSON.stringify(list.body)).not.toContain("password");
});
it("admin disable atomically revokes sessions, enable does not revive old cookies, and writes audit", async () => {
  const t = await login(),
    a = await login(admin);
  const patch = (body: unknown) =>
    request(app())
      .patch("/api/admin/accounts/" + teacherId)
      .set("Cookie", cookie(a))
      .set("Origin", origin)
      .set("X-CSRF-Token", a.body.csrfToken)
      .send(body as object);
  expect(
    (await patch({ status: "disabled", displayName: "已分发老师" })).status,
  ).toBe(200);
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", cookie(t)))
      .status,
  ).toBe(401);
  expect((await login()).status).toBe(401);
  expect((await patch({ status: "active" })).status).toBe(200);
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", cookie(t)))
      .status,
  ).toBe(401);
  expect((await login()).status).toBe(200);
  await db.exec("RESET ROLE");
  expect((await db.query("SELECT * FROM pilot_auth.audit")).rows).toHaveLength(
    2,
  );
});
it("cannot disable the last active administrator", async () => {
  const a = await login(admin);
  const res = await request(app())
    .patch("/api/admin/accounts/" + a.body.user.id)
    .set("Cookie", cookie(a))
    .set("Origin", origin)
    .set("X-CSRF-Token", a.body.csrfToken)
    .send({ status: "disabled" });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("last_admin");
});
it("expires teacher sessions at the idle boundary", async () => {
  const res = await login();
  now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", cookie(res)))
      .status,
  ).toBe(401);
});
it("expires admin sessions at the idle boundary", async () => {
  const res = await login(admin);
  now = new Date(now.getTime() + 30 * 60 * 1000);
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", cookie(res)))
      .status,
  ).toBe(401);
});
it("enforces absolute expiry even while sessions remain active", async () => {
  const res = await login(admin);
  for (let step = 0; step < 24; step++) {
    now = new Date(now.getTime() + 29 * 60 * 1000);
    expect(
      (await request(app()).get("/api/auth/session").set("Cookie", cookie(res)))
        .status,
    ).toBe(200);
  }
  now = new Date("2026-09-13T12:00:00Z");
  expect(
    (await request(app()).get("/api/auth/session").set("Cookie", cookie(res)))
      .status,
  ).toBe(401);
});
it("shares account rate limits across app instances and expires the window", async () => {
  for (let attempt = 0; attempt < 8; attempt++)
    expect((await login(teacher, "wrong")).status).toBe(401);
  const res = await login();
  expect(res.status).toBe(429);
  now = new Date(now.getTime() + 15 * 60 * 1000);
  expect((await login()).status).toBe(200);
});
it("returns safe JSON for unknown API, malformed JSON, and unavailable grading", async () => {
  const unknown = await request(app()).get("/api/unknown");
  expect(unknown.status).toBe(404);
  expect(unknown.body.error.code).toBe("not_found");
  const bad = await request(app())
    .post("/api/auth/login")
    .set("Origin", origin)
    .set("Content-Type", "application/json")
    .send("{private-malformed");
  expect(bad.status).toBe(400);
  expect(JSON.stringify(bad.body)).not.toContain("private-malformed");
  for (const path of ["/api/grading/grade-images", "/api/tasks/new"]) {
    const r = await request(app()).post(path).set("Origin", origin);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("pilot_grading_not_configured");
  }
});
it("prevents a login whose password was checked before disable from creating a session after re-enable", async () => {
  const snapshot = await repo.findLogin(teacher),
    a = await login(admin);
  const patch = (status: string) =>
    request(app())
      .patch("/api/admin/accounts/" + teacherId)
      .set("Cookie", cookie(a))
      .set("Origin", origin)
      .set("X-CSRF-Token", a.body.csrfToken)
      .send({ status });
  expect((await patch("disabled")).status).toBe(200);
  expect((await patch("active")).status).toBe(200);
  expect(
    await repo.createSession(
      teacherId,
      snapshot!.session_version,
      digest("stale-login-token"),
      now,
    ),
  ).toBeUndefined();
  expect(
    (
      await db.query("SELECT * FROM pilot_auth.sessions WHERE account_id=$1", [
        teacherId,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("bounds simultaneous real scrypt verification across app instances", async () => {
  const results = await Promise.all([
    login(teacher),
    login(manifest.accounts[1].username),
    login(manifest.accounts[2].username),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 200, 429]);
});
it("shares the source rate bucket across accounts and ignores forged forwarding headers locally", async () => {
  const sourceBucket = keyedDigest(config.secret, "source:::ffff:127.0.0.1");
  for (let attempt = 0; attempt < 60; attempt++)
    expect(
      await repo.takeRateLimit(
        keyedDigest(config.secret, `account:synthetic-${attempt}`),
        sourceBucket,
        now,
      ),
    ).toBe(true);
  const res = await request(app())
    .post("/api/auth/login")
    .set("Origin", origin)
    .set("X-Forwarded-For", "203.0.113.7")
    .set("X-Vercel-Forwarded-For", "203.0.113.8")
    .send({ username: teacher, password });
  expect(res.status).toBe(429);
});
it("one shared rate-limit slot can be consumed only once by concurrent app repositories", async () => {
  const second = new AuthRepository(db),
    account = digest("concurrent-account"),
    source = digest("concurrent-source");
  for (let n = 0; n < 7; n++)
    expect(await repo.takeRateLimit(account, source, now)).toBe(true);
  expect(
    (
      await Promise.all([
        repo.takeRateLimit(account, source, now),
        second.takeRateLimit(account, source, now),
      ])
    ).sort(),
  ).toEqual([false, true]);
});
it("two concurrent administrator disables leave an active administrator and revoke the loser", async () => {
  await db.exec("RESET ROLE");
  await db.query("UPDATE pilot_auth.accounts SET role='admin' WHERE id=$1", [
    teacherId,
  ]);
  await db.exec("SET ROLE wj_auth_runtime");
  try {
    const first = await login(teacher),
      second = await login(admin);
    const disable = (auth: request.Response, id: string) =>
      request(app())
        .patch("/api/admin/accounts/" + id)
        .set("Cookie", cookie(auth))
        .set("Origin", origin)
        .set("X-CSRF-Token", auth.body.csrfToken)
        .send({ status: "disabled" });
    const result = await Promise.all([
      disable(first, second.body.user.id),
      disable(second, first.body.user.id),
    ]);
    expect(result.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      result.filter((r) => r.status === 401 || r.status === 409),
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT id FROM pilot_auth.accounts WHERE role='admin' AND status='active'",
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE pilot_auth.accounts SET role='teacher' WHERE id=$1",
      [teacherId],
    );
  }
});
