import type { Express } from "express";
import { readConfig, readPilotConfig } from "./config.js";
import { createPostgresDatabase } from "./database.js";
import { AuthRepository } from "./repository.js";
import { createApp } from "./server.js";
import { createPilotRuntime } from "./pilot/runtime.js";
import {
  assertRuntimePrivileges,
  assertPilotRuntimePrivileges,
  assertMigrationRuntimePrivileges,
} from "./privileges.js";
import { createMigrationGate } from "./pilot/migrationGate.js";
import {
  assertDiskAccessible,
  assertDiskReady,
  assertWorkerReady,
} from "./standalone/readiness.js";
import { isAbsolute } from "node:path";
let appPromise: Promise<Express> | undefined;
export async function getRuntimeApp(): Promise<Express> {
  const config = readConfig(process.env);
  if (config.storage !== "postgres") throw Error("runtime_requires_postgres");
  if (!appPromise) {
    appPromise = (async () => {
      const db = createPostgresDatabase(config.databaseUrl!, config.ca);
      try {
        await assertRuntimePrivileges(db);
        const pilotConfig = readPilotConfig(process.env);
        const migrationGate = pilotConfig.migrationGate
          ? createMigrationGate(db)
          : undefined;
        if (migrationGate)
          await assertMigrationRuntimePrivileges(
            db,
            pilotConfig.queue === "postgres",
          );
        let pilotRuntime = createPilotRuntime(db, process.env, {
          migrationGate,
        });
        if (pilotRuntime) {
          try {
            await assertPilotRuntimePrivileges(db);
          } catch {
            if (migrationGate) throw Error("pilot_database_not_ready");
            pilotRuntime = undefined;
          }
        }
        return createApp(
          new AuthRepository(
            migrationGate ? migrationGate.guardDatabase(db) : db,
          ),
          config,
          undefined,
          {
            pilotRuntime,
            migrationGate,
          },
        );
      } catch (error) {
        await db.close();
        throw error;
      }
    })().catch((error) => {
      appPromise = undefined;
      throw error;
    });
  }
  return appPromise;
}

export async function openStandaloneRuntime(
  env: NodeJS.ProcessEnv,
  purpose: "service" | "maintenance" = "service",
) {
  const config = readConfig(env),
    pilotConfig = readPilotConfig(env, true);
  if (
    config.storage !== "postgres" ||
    env.VERCEL === "1" ||
    !env.PILOT_WORKER_HEARTBEAT_FILE ||
    !isAbsolute(env.PILOT_WORKER_HEARTBEAT_FILE)
  )
    throw Error("standalone_configuration_incomplete");
  const db = createPostgresDatabase(config.databaseUrl!, config.ca);
  try {
    await assertPilotRuntimePrivileges(db);
    await assertMigrationRuntimePrivileges(db, true);
    // Cleanup must remain available below the admission headroom threshold.
    // Its directory/symlink/access checks are identical; API/worker startup and
    // all readiness checks continue requiring ten GiB of free space.
    if (purpose === "maintenance")
      await assertDiskAccessible(pilotConfig.diskRoot!);
    else await assertDiskReady(pilotConfig.diskRoot!);
    const migrationGate = createMigrationGate(db);
    const pilotRuntime = createPilotRuntime(db, env, {
      standalone: true,
      migrationGate,
    })!;
    const readiness = async () => {
      // Read-only even while frozen. Never call provider or recover/consume jobs.
      await assertPilotRuntimePrivileges(db);
      await assertMigrationRuntimePrivileges(db, true);
      await migrationGate.assertOpen();
      await assertDiskReady(pilotConfig.diskRoot!);
      await assertWorkerReady(env.PILOT_WORKER_HEARTBEAT_FILE!);
    };
    const app = createApp(
      new AuthRepository(migrationGate.guardDatabase(db)),
      config,
      undefined,
      { pilotRuntime, migrationGate, readiness },
    );
    return { app, pilotRuntime, readiness, close: () => db.close() };
  } catch (error) {
    await db.close();
    throw error;
  }
}
