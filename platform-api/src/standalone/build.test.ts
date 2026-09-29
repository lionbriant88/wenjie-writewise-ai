import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  validateRelease,
  releaseFiles,
} from "../../../deploy/tencent/build.mjs";
it("release allowlist preserves package boundaries and excludes local files and credentials", () => {
  const files = releaseFiles([
    "platform-api/src/index.js",
    "grading-gateway/src/server.js",
    "app/src/services/grading/scoringRules.js",
    "shared/pilotContracts.js",
    "platform-api/src/server.test.js",
    "platform-api/src/testSupport.js",
    ".env",
    "local-private-accounts/key.json",
    "platform-api/node_modules/express/index.js",
    "platform-api/src/key.pem",
  ]);
  expect(files).toEqual([
    "platform-api/src/index.js",
    "grading-gateway/src/server.js",
    "app/src/services/grading/scoringRules.js",
    "shared/pilotContracts.js",
  ]);
  expect(() => validateRelease("../../outside")).toThrow();
  expect(validateRelease("20260929-abcdef0")).toBe("20260929-abcdef0");
});
it("migratePilot loads all SQL resources in order without using cwd", async () => {
  const { migratePilot } = await import("../pilot/migrate.js");
  const statements: string[] = [];
  await migratePilot({
    exec: async (sql) => {
      statements.push(sql);
    },
  });
  expect(statements).toHaveLength(3);
  for (const [i, file] of [
    "002_pilot_grading.sql",
    "003_pilot_deliveries.sql",
    "004_pilot_migration_control.sql",
  ].entries())
    expect(statements[i]).toBe(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
});
