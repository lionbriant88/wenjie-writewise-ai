import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import request from "supertest";
import { expect, it } from "vitest";
import { createLocalDatabase } from "../src/localDatabase.js";
import { AuthRepository } from "../src/repository.js";
import { createApp } from "../src/server.js";
import { readConfig } from "../src/config.js";
import type { Manifest } from "./manifest.js";
const run = promisify(execFile),
  root = fileURLToPath(new URL("../../", import.meta.url)),
  pkg = resolve(root, "platform-api");
const cleanEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  NODE_ENV: "development",
  // Child processes intentionally omit user configuration; trust only this test repository.
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.directory",
  GIT_CONFIG_VALUE_0: root,
};
const cli = (args: string[], env: NodeJS.ProcessEnv) =>
  run(process.execPath, ["--import", "tsx", "scripts/accounts.ts", ...args], {
    cwd: pkg,
    env: { ...cleanEnv, ...env },
    maxBuffer: 100000,
  });
it("runs prepare/migrate/apply/replay as real CLI processes and restores persisted accounts/sessions/disable after reopen", async () => {
  const key = randomUUID(),
    relative = `local-private-accounts/cli-${key}`,
    out = resolve(root, relative),
    path = resolve(root, "platform-api/local-auth-data", key),
    password = randomBytes(20).toString("hex");
  const env = {
    AUTH_STORAGE: "local",
    AUTH_LOCAL_PATH: path,
    PILOT_INITIAL_PASSWORD: password,
  };
  try {
    const prepared = await cli(["prepare", "--out", relative], env);
    expect(prepared.stdout.trim()).toBe(
      "prepared_awaiting_cloud_apply teachers=30 admins=1",
    );
    expect(prepared.stderr).toBe("");
    expect(prepared.stdout).not.toContain(password);
    expect((await cli(["migrate"], env)).stdout.trim()).toBe(
      "local_migration_applied",
    );
    expect(
      (
        await cli(["apply", "--manifest", `${relative}/manifest.json`], env)
      ).stdout.trim(),
    ).toBe("local_applied teachers=30 admins=1");
    expect(
      (
        await cli(["apply", "--manifest", `${relative}/manifest.json`], env)
      ).stdout.trim(),
    ).toBe("local_replayed teachers=30 admins=1");
    const manifest = JSON.parse(
      await readFile(resolve(out, "manifest.json"), "utf8"),
    ) as Manifest;
    const config = readConfig({
      ...env,
      APP_ORIGIN: "http://127.0.0.1:5173",
      AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
    });
    let db = createLocalDatabase(path);
    await db.exec("SET ROLE wj_auth_runtime");
    let app = createApp(new AuthRepository(db), config);
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", config.origin)
      .send({ username: manifest.accounts[0].username, password });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"][0]).toMatch(/^wj_dev_session=/);
    expect(login.headers["set-cookie"][0]).not.toContain("Secure");
    const sessionCookie = login.headers["set-cookie"][0].split(";")[0];
    const admin = await request(app)
      .post("/api/auth/login")
      .set("Origin", config.origin)
      .send({ username: manifest.accounts[30].username, password });
    expect(admin.status).toBe(200);
    expect(
      (
        await request(app)
          .patch("/api/admin/accounts/" + manifest.accounts[1].id)
          .set("Origin", config.origin)
          .set("Cookie", admin.headers["set-cookie"][0].split(";")[0])
          .set("X-CSRF-Token", admin.body.csrfToken)
          .send({ status: "disabled" })
      ).status,
    ).toBe(200);
    await db.close();
    db = createLocalDatabase(path);
    await db.exec("SET ROLE wj_auth_runtime");
    app = createApp(new AuthRepository(db), config);
    try {
      const session = await request(app)
        .get("/api/auth/session")
        .set("Cookie", sessionCookie);
      expect(session.status).toBe(200);
      expect(session.body.csrfToken).toBe(login.body.csrfToken);
      expect(
        (await db.query("SELECT * FROM pilot_auth.accounts")).rows,
      ).toHaveLength(31);
      expect(
        (
          await request(app)
            .post("/api/auth/login")
            .set("Origin", config.origin)
            .send({ username: manifest.accounts[1].username, password })
        ).status,
      ).toBe(401);
    } finally {
      await db.close();
    }
  } finally {
    await rm(out, { recursive: true, force: true });
    await rm(path, { recursive: true, force: true });
  }
});
it("CLI refuses missing admin configuration, unknown options and overwrites without leaking input", async () => {
  for (const args of [
    ["migrate"],
    ["prepare", "--password", "private-sentinel"],
  ]) {
    try {
      await cli(args, {});
      throw Error("expected_failure");
    } catch (error) {
      const result = error as { code: number; stdout: string; stderr: string };
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("private-sentinel");
      expect(result.stderr.trim()).toMatch(
        /^(admin_database_required|usage_invalid)$/,
      );
    }
  }
});
