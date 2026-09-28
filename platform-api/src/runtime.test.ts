import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import handler from "./vercel.js";
import { getRuntimeApp } from "./runtime.js";
import { createPilotRuntime } from "./pilot/runtime.js";
import { pilotTestDb } from "./pilot/testSupport.js";
import { assertPilotRuntimePrivileges } from "./privileges.js";
it("pilotDependenciesFailClosedWithoutAffectingAuthAndRuntimeRoleIsRestricted", async () => {
  const db = await pilotTestDb();
  try {
    expect(createPilotRuntime(db, {})).toBeUndefined();
    expect(createPilotRuntime(db, { PILOT_MVP_ENABLED: "1" })).toBeUndefined();
    await db.exec("SET ROLE wj_auth_runtime");
    await expect(assertPilotRuntimePrivileges(db)).resolves.toBeUndefined();
    await db.exec("RESET ROLE");
    await expect(assertPilotRuntimePrivileges(db)).rejects.toThrow();
  } finally {
    await db.close();
  }
});
afterEach(() => vi.unstubAllEnvs());
it("Vercel handler fails closed with a generic no-store JSON 503 when runtime configuration is absent", async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("AUTH_RATE_LIMIT_SECRET", "private-sentinel");
  const res = await request(handler).get("/api/auth/session");
  expect(res.status).toBe(503);
  expect(res.body).toEqual({
    error: {
      code: "service_unavailable",
      message: "服务暂不可用，请稍后重试。",
    },
  });
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.text).not.toContain("private-sentinel");
});
it("Vercel entry never opens local storage, even outside NODE_ENV production", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AUTH_STORAGE", "local");
  vi.stubEnv("AUTH_LOCAL_PATH", "local-auth-data");
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:5173");
  vi.stubEnv("AUTH_RATE_LIMIT_SECRET", "s".repeat(40));
  await expect(getRuntimeApp()).rejects.toThrow("runtime_requires_postgres");
});
