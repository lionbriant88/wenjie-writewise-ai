import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresDatabase } from "../src/database.js";
import { resumeKnownPause } from "../src/pilot/admission.js";
export async function runResume(
  env: NodeJS.ProcessEnv,
  revision: number,
): Promise<void> {
  if (!env.DATABASE_URL) throw Error("database_required");
  const db = createPostgresDatabase(env.DATABASE_URL, env.DATABASE_CA_CERT);
  try {
    await resumeKnownPause(db, revision, env);
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || !/^\d+$/.test(process.argv[2]))
    throw Error("usage: resumePilotQueue <expectedPauseRevision>");
  runResume(process.env, Number(process.argv[2]))
    .then(() => console.log("known_pause_resumed"))
    .catch(() => {
      console.error("queue_resume_refused");
      process.exitCode = 1;
    });
}
