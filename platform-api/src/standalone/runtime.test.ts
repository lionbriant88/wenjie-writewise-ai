import { expect, it } from "vitest";
import { readPilotConfig } from "../config.js";
import { createPilotRuntime } from "../pilot/runtime.js";
import { pilotTestDb } from "../pilot/testSupport.js";
import { assertMigrationRuntimePrivileges } from "../privileges.js";
import { startStandaloneApi } from "./api.js";

const env = {
  PILOT_MVP_ENABLED: "1",
  PILOT_STORAGE_BACKEND: "disk",
  PILOT_QUEUE_BACKEND: "postgres",
  PILOT_MIGRATION_GATE_ENABLED: "1",
  PILOT_DISK_ROOT: process.cwd(),
  PILOT_FILE_SIGNING_KEY: "s".repeat(64),
  APP_ORIGIN: "https://school.example",
  GRADING_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "synthetic-not-a-real-key",
};
it("standalone executable never falls back to account-only for absent mode/backend flags", async () => {
  await expect(
    startStandaloneApi({
      APP_ORIGIN: "https://school.example",
      AUTH_RATE_LIMIT_SECRET: "a".repeat(40),
      DATABASE_URL: "postgres://local:local@127.0.0.1:1/local",
    }),
  ).rejects.toThrow("standalone_configuration_incomplete");
});
it("keeps legacy backend defaults and requires explicit complete standalone backends", () => {
  expect(readPilotConfig({})).toMatchObject({
    storage: "supabase",
    queue: "vercel",
    migrationGate: false,
  });
  expect(readPilotConfig(env, true)).toMatchObject({
    storage: "disk",
    queue: "postgres",
    migrationGate: true,
  });
  for (const change of [
    { PILOT_STORAGE_BACKEND: "other" },
    { PILOT_QUEUE_BACKEND: "memory" },
    { PILOT_MIGRATION_GATE_ENABLED: "0" },
    { PILOT_FILE_SIGNING_KEY: "" },
    { PILOT_DISK_ROOT: "relative" },
    { PILOT_MVP_ENABLED: "0" },
  ])
    expect(() => readPilotConfig({ ...env, ...change }, true)).toThrow();
});
it("explicit standalone startup fails instead of silently providing account-only service", async () => {
  const db = await pilotTestDb();
  try {
    expect(() =>
      createPilotRuntime(
        db,
        { ...env, DEEPSEEK_API_KEY: "" },
        { standalone: true },
      ),
    ).toThrow();
    // PGlite cannot implement backend-held locks. Assembly must not open a
    // connection or call a provider; real PG lock behavior has separate tests.
    const runtime = createPilotRuntime(
      {
        ...db,
        withConnection: async () => {
          throw Error("unexpected_connection");
        },
      },
      env,
      { standalone: true },
    );
    expect(runtime?.diskStorage).toBeDefined();
    expect(runtime?.postgresQueue).toBeDefined();
    expect(runtime?.migrationGate).toBeDefined();
    await db.exec("SET ROLE wj_auth_runtime");
    await expect(
      assertMigrationRuntimePrivileges(db, true),
    ).resolves.toBeUndefined();
    await db.exec(
      "RESET ROLE; REVOKE UPDATE ON pilot_grading.deliveries FROM wj_auth_runtime; SET ROLE wj_auth_runtime",
    );
    await expect(assertMigrationRuntimePrivileges(db, true)).rejects.toThrow();
  } finally {
    await db.close();
  }
});
