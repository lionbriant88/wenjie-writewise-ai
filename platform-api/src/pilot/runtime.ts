import { createPostgresDatabase, type Database } from "../database.js";
import { assertPilotRuntimePrivileges } from "../privileges.js";
import { createPilotProvider } from "../grading.js";
import { createPrivateStorage } from "./storage.js";
import { createJobQueue } from "./queue.js";
import { PilotUploadService } from "./uploads.js";
import type { WorkerDeps } from "./worker.js";
export type PilotRuntime = WorkerDeps;
function assemble(db: Database, env: NodeJS.ProcessEnv): PilotRuntime {
  if (env.PILOT_MVP_ENABLED !== "1" || (env.CRON_SECRET?.length ?? 0) < 24)
    throw Error("pilot_not_configured");
  const storage = createPrivateStorage({
    url: env.SUPABASE_URL ?? "",
    bucket: env.SUPABASE_STORAGE_BUCKET ?? "",
    serviceKey: env.SUPABASE_STORAGE_SERVICE_KEY ?? "",
  });
  return {
    db,
    storage,
    uploads: new PilotUploadService(db, storage),
    queue: createJobQueue(),
    providerFactory: () => createPilotProvider(env),
  };
}
export function createPilotRuntime(
  db: Database,
  env: NodeJS.ProcessEnv,
): PilotRuntime | undefined {
  try {
    createPilotProvider(env);
    return assemble(db, env);
  } catch {
    return undefined;
  }
}
let runtime: Promise<WorkerDeps> | undefined;
export function getPilotRuntime(): Promise<WorkerDeps> {
  if (!runtime)
    runtime = (async () => {
      const env = process.env;
      if (env.PILOT_MVP_ENABLED !== "1" || !env.DATABASE_URL)
        throw Error("pilot_not_configured");
      const db = createPostgresDatabase(env.DATABASE_URL, env.DATABASE_CA_CERT);
      try {
        await assertPilotRuntimePrivileges(db);
        await db.query("SELECT singleton FROM pilot_grading.provider_gate");
        return assemble(db, env);
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
