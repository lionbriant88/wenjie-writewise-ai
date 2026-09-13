import type { Express } from "express";
import { readConfig } from "./config.js";
import { createPostgresDatabase } from "./database.js";
import { AuthRepository } from "./repository.js";
import { createApp } from "./server.js";
import { assertRuntimePrivileges } from "./privileges.js";
let appPromise: Promise<Express> | undefined;
export async function getRuntimeApp(): Promise<Express> {
  const config = readConfig(process.env);
  if (config.storage !== "postgres") throw Error("runtime_requires_postgres");
  if (!appPromise) {
    appPromise = (async () => {
      const db = createPostgresDatabase(config.databaseUrl!, config.ca);
      try {
        await assertRuntimePrivileges(db);
        return createApp(new AuthRepository(db), config);
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
