import { createPostgresDatabase, type Database } from "../database.js";
import { readPilotConfig } from "../config.js";
import {
  assertPilotRuntimePrivileges,
  assertMigrationRuntimePrivileges,
} from "../privileges.js";
import { createPilotProvider } from "../grading.js";
import { createPrivateStorage } from "./storage.js";
import { createDiskStorage, type DiskStorage } from "./diskStorage.js";
import { createJobQueue } from "./queue.js";
import { createPostgresQueue, type PostgresJobQueue } from "./postgresQueue.js";
import { createMigrationGate, type MigrationGate } from "./migrationGate.js";
import { StorageQuota } from "./storageQuota.js";
import { PilotUploadService } from "./uploads.js";
import type { WorkerDeps } from "./worker.js";
export interface PilotRuntime extends WorkerDeps {
  diskStorage?: DiskStorage;
  postgresQueue?: PostgresJobQueue;
}
export interface PilotRuntimeOptions {
  standalone?: boolean;
  migrationGate?: MigrationGate;
}
function assemble(
  rawDb: Database,
  env: NodeJS.ProcessEnv,
  options: PilotRuntimeOptions,
): PilotRuntime {
  const config = readPilotConfig(env, options.standalone);
  if (
    env.PILOT_MVP_ENABLED !== "1" ||
    (config.queue === "vercel" && (env.CRON_SECRET?.length ?? 0) < 24)
  )
    throw Error("pilot_not_configured");
  createPilotProvider(env);
  const migrationGate = config.migrationGate
    ? (options.migrationGate ?? createMigrationGate(rawDb))
    : undefined;
  const db = migrationGate ? migrationGate.guardDatabase(rawDb) : rawDb;
  const diskStorage =
    config.storage === "disk"
      ? createDiskStorage({
          root: config.diskRoot!,
          origin: env.APP_ORIGIN ?? "",
          signingKey: config.signingKey!,
        })
      : undefined;
  const storage =
    diskStorage ??
    createPrivateStorage({
      url: env.SUPABASE_URL ?? "",
      bucket: env.SUPABASE_STORAGE_BUCKET ?? "",
      serviceKey: env.SUPABASE_STORAGE_SERVICE_KEY ?? "",
    });
  const postgresQueue =
    config.queue === "postgres" ? createPostgresQueue(db) : undefined;
  return {
    db,
    storage,
    diskStorage,
    postgresQueue,
    migrationGate,
    uploads: new PilotUploadService(
      db,
      storage,
      diskStorage ? new StorageQuota() : undefined,
    ),
    queue: postgresQueue ?? createJobQueue(),
    providerFactory: () => createPilotProvider(env),
  };
}
export function createPilotRuntime(
  db: Database,
  env: NodeJS.ProcessEnv,
  options: PilotRuntimeOptions = {},
): PilotRuntime | undefined {
  try {
    return assemble(db, env, options);
  } catch (error) {
    if (options.standalone || env.PILOT_MIGRATION_GATE_ENABLED === "1")
      throw error;
    return undefined;
  }
}
let runtime: Promise<PilotRuntime> | undefined;
export function getPilotRuntime(): Promise<PilotRuntime> {
  if (!runtime)
    runtime = (async () => {
      const env = process.env;
      if (env.PILOT_MVP_ENABLED !== "1" || !env.DATABASE_URL)
        throw Error("pilot_not_configured");
      const db = createPostgresDatabase(env.DATABASE_URL, env.DATABASE_CA_CERT);
      try {
        await assertPilotRuntimePrivileges(db);
        const config = readPilotConfig(env);
        if (config.migrationGate)
          await assertMigrationRuntimePrivileges(
            db,
            config.queue === "postgres",
          );
        await db.query("SELECT singleton FROM pilot_grading.provider_gate");
        return assemble(db, env, {});
      } catch (error) {
        await db.close();
        throw error;
      }
    })().catch((error) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
}
