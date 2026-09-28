import { createPostgresDatabase } from "../database.js";
import { assertRuntimePrivileges } from "../privileges.js";
import { createPilotProvider } from "../grading.js";
import { createPrivateStorage } from "./storage.js";
import { createJobQueue } from "./queue.js";
import { PilotUploadService } from "./uploads.js";
import type { WorkerDeps } from "./worker.js";
let runtime: Promise<WorkerDeps> | undefined;
export function getPilotRuntime(): Promise<WorkerDeps> {
  if (!runtime)
    runtime = (async () => {
      const env = process.env;
      if (env.PILOT_MVP_ENABLED !== "1" || !env.DATABASE_URL)
        throw Error("pilot_not_configured");
      const storage = createPrivateStorage({
        url: env.SUPABASE_URL ?? "",
        bucket: env.SUPABASE_STORAGE_BUCKET ?? "",
        serviceKey: env.SUPABASE_STORAGE_SERVICE_KEY ?? "",
      });
      const db = createPostgresDatabase(env.DATABASE_URL, env.DATABASE_CA_CERT);
      try {
        await assertRuntimePrivileges(db);
        await db.query("SELECT singleton FROM pilot_grading.provider_gate");
        return {
          db,
          storage,
          uploads: new PilotUploadService(db, storage),
          queue: createJobQueue(),
          providerFactory: () => createPilotProvider(env),
        };
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
