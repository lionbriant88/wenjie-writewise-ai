import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { Database, Queryable } from "../database.js";
import type { RecoveryDeps } from "../pilot/recovery.js";
import { openStandaloneRuntime } from "../runtime.js";
import { executeStandaloneMaintenance } from "./maintenance.js";

const state = vi.hoisted(() => ({ frozen: false, active: 0, cleaned: 0 }));
const objectPath =
  "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002";
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  statfs: async () => ({ bavail: 9, bsize: 1024 ** 3 }),
}));
vi.mock("../database.js", () => ({
  createPostgresDatabase: () => {
    const query: Queryable["query"] = async (sql) => {
      if (
        sql.includes("has_table_privilege") ||
        sql.includes("has_schema_privilege")
      )
        return { rows: [{ safe: true }] } as never;
      if (sql.includes("enter_migration")) {
        if (state.frozen) return { rows: [{ admitted: false }] } as never;
        state.active++;
        return { rows: [{ admitted: true }] } as never;
      }
      if (sql.includes("leave_migration")) {
        state.active--;
        return { rows: [{ released: true }] } as never;
      }
      if (sql.includes("SELECT frozen"))
        return { rows: [{ frozen: state.frozen }] } as never;
      throw Error("unexpected_sql");
    };
    const db: Database = {
      query,
      exec: query,
      close: async () => {},
      transaction: async (fn) => fn({ query }),
      withConnection: async (fn) =>
        fn({
          query,
          transaction: async (tx) => tx({ query }),
          signal: new AbortController().signal,
        }),
    };
    return db;
  },
}));
// Recovery's expiry rules have separate repository tests. This records whether
// the real maintenance startup reaches cleanup, and performs a real disk removal.
vi.mock("../pilot/recovery.js", () => ({
  recoverPilotWork: async (deps: RecoveryDeps) => {
    expect(state.active).toBe(1);
    await deps.storage.remove([objectPath]);
    state.cleaned++;
    return { published: 0, cleaned: 1 };
  },
}));
afterEach(() => {
  state.frozen = false;
  state.active = 0;
  state.cleaned = 0;
});
function environment(root: string): NodeJS.ProcessEnv {
  return {
    APP_ORIGIN: "https://school.example",
    AUTH_RATE_LIMIT_SECRET: "a".repeat(40),
    DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1:1/synthetic",
    PILOT_MVP_ENABLED: "1",
    PILOT_STORAGE_BACKEND: "disk",
    PILOT_QUEUE_BACKEND: "postgres",
    PILOT_MIGRATION_GATE_ENABLED: "1",
    PILOT_DISK_ROOT: root,
    PILOT_FILE_SIGNING_KEY: "s".repeat(64),
    PILOT_WORKER_HEARTBEAT_FILE: join(root, "worker.json"),
    PILOT_MAINTENANCE_ENABLED: "1",
    GRADING_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "synthetic-not-real",
  };
}
it("low-space maintenance can reclaim files while service startup still enforces ten GiB", async () => {
  const root = await mkdtemp(join(tmpdir(), "wj-maintenance-lowspace-"));
  try {
    const file = join(root, objectPath);
    await mkdir(join(root, objectPath.split("/")[0]));
    await writeFile(file, "expired synthetic bytes");
    await expect(openStandaloneRuntime(environment(root))).rejects.toThrow(
      "storage_not_ready",
    );
    expect(await readFile(file, "utf8")).toBe("expired synthetic bytes");
    await executeStandaloneMaintenance(environment(root));
    expect(state.cleaned).toBe(1);
    expect(state.active).toBe(0);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    const maintenanceRuntime = await openStandaloneRuntime(
      environment(root),
      "maintenance",
    );
    try {
      await expect(maintenanceRuntime.readiness()).rejects.toThrow(
        "storage_not_ready",
      );
    } finally {
      await maintenanceRuntime.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("maintenance still rejects structurally missing storage and frozen admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "wj-maintenance-frozen-"));
  try {
    await expect(
      executeStandaloneMaintenance(environment(join(root, "missing"))),
    ).rejects.toThrow();
    state.frozen = true;
    await expect(
      executeStandaloneMaintenance(environment(root)),
    ).rejects.toMatchObject({ code: "migration_frozen" });
    expect(state.cleaned).toBe(0);
    expect(state.active).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
