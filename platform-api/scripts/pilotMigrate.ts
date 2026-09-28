import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresDatabase } from "../src/database.js";
import { migratePilot } from "../src/pilot/migrate.js";
export async function runPilotMigration(env: NodeJS.ProcessEnv): Promise<void> {
  if (!env.DATABASE_ADMIN_URL) throw Error("admin_database_required");
  const db = createPostgresDatabase(
    env.DATABASE_ADMIN_URL,
    env.DATABASE_CA_CERT,
  );
  try {
    await migratePilot(db);
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2) throw Error("usage_invalid");
  runPilotMigration(process.env)
    .then(() => console.log("pilot_migration_applied"))
    .catch(() => {
      console.error("pilot_migration_failed");
      process.exitCode = 1;
    });
}
