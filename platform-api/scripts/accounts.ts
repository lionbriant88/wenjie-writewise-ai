import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresDatabase, type Database } from "../src/database.js";
import { migrate } from "../src/migrate.js";
import { applyManifest } from "./manifest.js";
import { prepareAccounts, repoRoot } from "./prepare.js";
async function database(env: NodeJS.ProcessEnv): Promise<Database> {
  if (env.AUTH_STORAGE === "local") {
    if (
      env.NODE_ENV === "production" ||
      env.VERCEL === "1" ||
      !env.AUTH_LOCAL_PATH
    )
      throw Error("local_storage_not_allowed");
    const { createLocalDatabase } = await import("../src/localDatabase.js");
    return createLocalDatabase(resolve(repoRoot, env.AUTH_LOCAL_PATH));
  }
  if (env.AUTH_STORAGE && env.AUTH_STORAGE !== "postgres")
    throw Error("configuration_invalid");
  if (!env.DATABASE_ADMIN_URL) throw Error("admin_database_required");
  return createPostgresDatabase(env.DATABASE_ADMIN_URL, env.DATABASE_CA_CERT);
}
export async function runAccounts(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const [command, flag, value, ...extra] = args;
  if (command === "prepare") {
    if (flag !== "--out" || !value || extra.length)
      throw Error("usage_invalid");
    await prepareAccounts(value, env.PILOT_INITIAL_PASSWORD ?? "");
    return "prepared_awaiting_cloud_apply teachers=30 admins=1";
  }
  if (
    (command !== "migrate" && command !== "apply") ||
    (command === "migrate" && (flag || value)) ||
    (command === "apply" && (flag !== "--manifest" || !value || extra.length))
  )
    throw Error("usage_invalid");
  let manifest: unknown;
  if (command === "apply") {
    const path = resolve(repoRoot, value);
    if ((await stat(path)).size > 100000) throw Error("invalid_manifest");
    manifest = JSON.parse(await readFile(path, "utf8"));
  }
  const db = await database(env);
  try {
    if (command === "migrate") {
      await migrate(db);
      return env.AUTH_STORAGE === "local"
        ? "local_migration_applied"
        : "database_migration_applied";
    }
    const result = await applyManifest(db, manifest);
    return `${env.AUTH_STORAGE === "local" ? "local" : "database"}_${result.applied ? "applied" : "replayed"} teachers=${result.teachers} admins=${result.admins}`;
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runAccounts(process.argv.slice(2), process.env)
    .then((message) => console.log(message))
    .catch((error) => {
      const allowed = [
        "usage_invalid",
        "private_output_required",
        "invalid_initial_password",
        "output_exists",
        "invalid_manifest",
        "batch_manifest_mismatch",
        "batch_integrity_failed",
        "admin_database_required",
        "local_storage_not_allowed",
        "configuration_invalid",
      ];
      console.error(
        allowed.includes(error?.message)
          ? error.message
          : "account_command_failed",
      );
      process.exitCode = 1;
    });
}
