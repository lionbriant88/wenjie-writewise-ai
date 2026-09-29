import request from "supertest";
import { expect, it, vi } from "vitest";
import { createApp, requestSource } from "../server.js";
import type { AuthConfig } from "../config.js";
import type { AuthRepository } from "../repository.js";
import { PilotError } from "../pilot/errors.js";
import type { MigrationGate } from "../pilot/migrationGate.js";
const config: AuthConfig = {
  origin: "https://school.example",
  secret: "x".repeat(40),
  secure: true,
  cookieName: "__Host-wj_session",
  trustedVercel: false,
  storage: "postgres",
};
it("rejects frozen login/session/admin/pilot before any auth work", async () => {
  const session = vi.fn(),
    takeRateLimit = vi.fn(),
    listAccounts = vi.fn();
  const gate: MigrationGate = {
    assertOpen: async () => {
      throw new PilotError("migration_frozen", 503);
    },
    run: async () => {
      throw Error("must not reach");
    },
    guardDatabase: (db) => db,
  };
  const app = createApp(
    { session, takeRateLimit, listAccounts } as unknown as AuthRepository,
    config,
    undefined,
    { migrationGate: gate },
  );
  for (const [method, path] of [
    ["post", "/api/auth/login"],
    ["get", "/api/auth/session"],
    ["get", "/api/admin/accounts"],
    ["patch", "/api/admin/accounts/a"],
    ["get", "/api/pilot/tasks"],
  ] as const) {
    const res = await request(app)
      [method](path)
      .set("Origin", config.origin)
      .send({ username: "test", password: "test" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("migration_frozen");
  }
  expect(session).not.toHaveBeenCalled();
  expect(takeRateLimit).not.toHaveBeenCalled();
  expect(listAccounts).not.toHaveBeenCalled();
});
it("holds auth admission until the actual handler promise settles", async () => {
  let active = 0,
    release!: () => void,
    entered!: () => void;
  const pending = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const gate: MigrationGate = {
    assertOpen: async () => {},
    guardDatabase: (db) => db,
    run: async (fn) => {
      active++;
      try {
        return await fn();
      } finally {
        active--;
      }
    },
  };
  const repo = {
    session: async () => {
      entered();
      await pending;
      expect(active).toBe(1);
      return undefined;
    },
  } as unknown as AuthRepository;
  const app = createApp(repo, config, undefined, { migrationGate: gate });
  const response = request(app)
    .get("/api/auth/session")
    .set("Cookie", config.cookieName + "=" + "x".repeat(43))
    .then((r) => r);
  await started;
  expect(active).toBe(1);
  release();
  expect((await response).status).toBe(401);
  expect(active).toBe(0);
});
it("only trusts a single overwritten proxy address on an explicitly enabled loopback peer", () => {
  const req = (remote: string, headers: Record<string, string>) =>
    ({
      socket: { remoteAddress: remote },
      get: (name: string) => headers[name],
    }) as never;
  expect(
    requestSource(
      req("198.51.100.2", {
        "x-forwarded-for": "203.0.113.9",
        "x-vercel-forwarded-for": "203.0.113.8",
      }),
      { ...config, trustedLoopbackProxy: true },
    ),
  ).toBe("198.51.100.2");
  expect(
    requestSource(req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), {
      ...config,
      trustedLoopbackProxy: true,
    }),
  ).toBe("203.0.113.9");
  expect(
    requestSource(
      req("127.0.0.1", { "x-forwarded-for": "203.0.113.9, 1.1.1.1" }),
      { ...config, trustedLoopbackProxy: true },
    ),
  ).toBe("127.0.0.1");
  expect(
    requestSource(
      req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }),
      config,
    ),
  ).toBe("127.0.0.1");
});
