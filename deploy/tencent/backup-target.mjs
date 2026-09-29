import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdir,
  open,
  readFile,
  stat,
  writeFile,
  lstat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  checkedDirectory,
  compareDiskInventories,
  scanDiskObjects,
  validateBackupInventory,
  verifyUploadObjects,
  within,
} from "./backup-support.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const save = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const SESSION =
  "SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle TO 'ISO, YMD'; SET LOCAL extra_float_digits TO 3; SET LOCAL bytea_output TO 'hex'; SET LOCAL statement_timeout TO '120s'";
const UPLOADS =
  'SELECT to_jsonb(u) AS record, EXISTS(SELECT 1 FROM pilot_grading.task_material_uploads r WHERE r.upload_id=u.id) AS "materialReference", EXISTS(SELECT 1 FROM pilot_grading.essay_pages r WHERE r.upload_id=u.id) AS "essayReference", EXISTS(SELECT 1 FROM pilot_grading.job_uploads r WHERE r.upload_id=u.id) AS "jobReference" FROM pilot_grading.uploads u ORDER BY u.id';
export function validateTargetConfig(config) {
  if (
    !config ||
    config.format !== "writewise-target-backup-config-v1" ||
    !config.expected ||
    typeof config.databaseUrl !== "string"
  )
    throw Error("invalid_target_backup_configuration");
  const url = new URL(config.databaseUrl),
    expected = config.expected;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password ||
    !url.port ||
    url.hostname !== expected.host ||
    Number(url.port) !== expected.port ||
    decodeURIComponent(url.pathname.slice(1)) !== expected.database ||
    decodeURIComponent(url.username) !== expected.user ||
    !/^writewise_[a-z0-9_]{1,80}$/.test(expected.database) ||
    !Number.isInteger(expected.port) ||
    expected.port < 1 ||
    expected.port > 65535
  )
    throw Error("unexpected_target_database_identity");
  for (const field of ["caFile", "originalsRoot", "pgBin"])
    if (typeof config[field] !== "string" || !isAbsolute(config[field]))
      throw Error("absolute_target_paths_required");
  return { url, expected };
}
export async function assertFrozenTarget(db) {
  const row = (
    await db.query(`SELECT c.frozen,c.frozen_at,
    (SELECT count(*)::int FROM pilot_grading.migration_admissions) AS admissions,
    (SELECT count(*)::int FROM pilot_grading.executions WHERE state IN ('preparing','calling','result_unknown')) AS executions,
    (SELECT count(*)::int FROM pilot_grading.jobs WHERE state IN ('running','result_unknown')) AS unsettled,
    (SELECT count(*)::int FROM pilot_grading.provider_gate WHERE active_execution_id IS NOT NULL) AS occupied
    FROM pilot_grading.migration_control c WHERE singleton=true`)
  ).rows[0];
  if (
    !row ||
    row.frozen !== true ||
    !row.frozen_at ||
    row.admissions !== 0 ||
    row.executions !== 0 ||
    row.unsettled !== 0 ||
    row.occupied !== 0
  )
    throw Error("frozen_drained_target_required");
  return String(row.frozen_at);
}
async function tableDigests(db) {
  const tables = (
    await db.query(
      "SELECT schemaname AS schema,tablename AS name FROM pg_tables WHERE schemaname IN ('pilot_auth','pilot_grading') ORDER BY schemaname,tablename",
    )
  ).rows;
  validateBackupInventory(tables, "disk");
  const output = [];
  for (const table of tables) {
    const hash = createHash("sha256");
    let count = 0;
    await db.query(
      `DECLARE backup_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS value FROM ${quote(table.schema)}.${quote(table.name)} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
    );
    for (;;) {
      const rows = (await db.query("FETCH 256 FROM backup_rows")).rows;
      if (!rows.length) break;
      for (const row of rows) {
        hash.update(row.value + "\n");
        count++;
      }
    }
    await db.query("CLOSE backup_rows");
    output.push({ ...table, rowCount: count, sha256: hash.digest("hex") });
  }
  return output;
}
async function fileDigest(path, maxBytes = 2 * 1024 ** 3) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 5 || info.size > maxBytes)
      throw Error("invalid_dump_size");
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      if (size === 0 && buffer.subarray(0, 5).toString() !== "PGDMP")
        throw Error("invalid_dump_archive");
      size += bytesRead;
      if (size > maxBytes) throw Error("dump_size_limit");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (size !== info.size) throw Error("dump_changed");
    return { file: "application.dump", size, sha256: hash.digest("hex") };
  } finally {
    await file.close();
  }
}
async function dumpSnapshot(config, url, snapshot, directory) {
  const exe = join(
    config.pgBin,
    process.platform === "win32" ? "pg_dump.exe" : "pg_dump",
  );
  if (!(await stat(exe)).isFile()) throw Error("pg_dump_required");
  const env = {};
  for (const key of [
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
  ])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    PGHOST: config.expected.host,
    PGPORT: String(config.expected.port),
    PGUSER: config.expected.user,
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: config.expected.database,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: config.caFile,
    PGCONNECT_TIMEOUT: "10",
    PGAPPNAME: "writewise_target_backup",
    PGOPTIONS: "-c statement_timeout=120000",
  });
  const log = await open(join(directory, "pg-dump.log"), "wx", 0o600),
    archive = join(directory, "application.dump");
  try {
    await new Promise((ok, reject) => {
      const child = spawn(
        exe,
        [
          "--format=custom",
          "--schema=pilot_auth",
          "--schema=pilot_grading",
          "--strict-names",
          "--no-password",
          "--lock-wait-timeout=10000",
          `--snapshot=${snapshot}`,
          `--file=${archive}`,
        ],
        { env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] },
      );
      let failure;
      const abort = (code) => {
        failure = Error(code);
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => abort("pg_dump_timeout"), 300000);
      const limit = setInterval(() => {
        void stat(archive)
          .then((s) => {
            if (s.size > 2 * 1024 ** 3) abort("pg_dump_size_limit");
          })
          .catch(() => {});
      }, 250);
      const clean = () => {
        clearTimeout(timer);
        clearInterval(limit);
      };
      child.once("error", () => {
        clean();
        reject(Error("pg_dump_start_failed"));
      });
      child.once("exit", (code) => {
        clean();
        failure
          ? reject(failure)
          : code === 0
            ? ok()
            : reject(Error("pg_dump_failed"));
      });
    });
  } finally {
    await log.close();
  }
}
// Dependency injection is only a programmatic offline test seam; the CLI has
// no fake mode and always opens strict-TLS PostgreSQL and the real pg_dump.
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--config" ||
    argv[2] !== "--output" ||
    !isAbsolute(argv[1]) ||
    !isAbsolute(argv[3])
  )
    throw Error("explicit_target_backup_arguments_required");
  const configFile = resolve(argv[1]),
    output = resolve(argv[3]);
  const info = await lstat(configFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
    throw Error("unsafe_target_configuration_file");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw Error("private_target_configuration_required");
  const config = JSON.parse(await readFile(configFile, "utf8")),
    { url, expected } = validateTargetConfig(config);
  await checkedDirectory(config.originalsRoot);
  await checkedDirectory(dirname(output));
  if (
    output === resolve(config.originalsRoot) ||
    within(config.originalsRoot, output) ||
    within(output, config.originalsRoot) ||
    within(output, configFile)
  )
    throw Error("overlapping_backup_directory");
  const ca = await readFile(config.caFile, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw Error("database_ca_required");
  const require = createRequire(
    resolve(HERE, "../../platform-api/package.json"),
  );
  const Client = dependencies.Client ?? require("pg").Client;
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, "objects"), { mode: 0o700 });
  const options = {
    host: expected.host,
    port: expected.port,
    user: expected.user,
    password: decodeURIComponent(url.password),
    database: expected.database,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
    application_name: "writewise_target_backup",
  };
  const db = new Client(options);
  let fresh,
    transaction = false;
  const manifest = {
    format: "writewise-readonly-backup-v1",
    createdAt: new Date().toISOString(),
    source: { storageBackend: "disk", database: expected.database },
    tables: [],
    uploads: [],
    objects: [],
    storageInventory: null,
  };
  const summary = {
    databaseBackupComplete: false,
    objectBackupComplete: false,
    missingRequiredObjects: 0,
    recordedUploadsMismatch: 0,
    verifiedObjects: 0,
    snapshotInventoryChanged: null,
    complete: false,
    modelCalls: 0,
  };
  try {
    await db.connect();
    const identity = (
      await db.query(
        "SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num') AS version,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls",
      )
    ).rows[0];
    if (
      identity.database !== expected.database ||
      identity.role !== expected.user ||
      identity.host !== expected.host ||
      identity.port !== expected.port ||
      identity.tls !== true ||
      !/^17\d{4}$/.test(identity.version)
    )
      throw Error("connected_target_identity_mismatch");
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    await db.query(SESSION);
    const frozenAt = await assertFrozenTarget(db);
    manifest.snapshot = (
      await db.query("SELECT pg_export_snapshot() AS snapshot")
    ).rows[0].snapshot;
    manifest.source.serverVersion = identity.version;
    manifest.tables = await tableDigests(db);
    manifest.uploads = (await db.query(UPLOADS)).rows.map(
      ({ record, ...references }) => ({ ...record, ...references }),
    );
    const accountCounts = (
      await db.query(
        "SELECT role,count(*)::int AS count FROM pilot_auth.accounts GROUP BY role ORDER BY role",
      )
    ).rows;
    await save(join(output, "metadata.json"), {
      accountCounts,
      roles: (
        await db.query(
          "SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('wj_auth_runtime','wj_auth_server') ORDER BY rolname",
        )
      ).rows,
      tableGrants: (
        await db.query(
          "SELECT * FROM information_schema.role_table_grants WHERE table_schema IN ('pilot_auth','pilot_grading') ORDER BY table_schema,table_name,grantee,privilege_type",
        )
      ).rows,
    });
    manifest.accountCounts = accountCounts;
    const before = await scanDiskObjects(config.originalsRoot, {
      outputDirectory: output,
    });
    manifest.objects = before;
    Object.assign(summary, verifyUploadObjects(manifest.uploads, before));
    await (dependencies.dumpSnapshot ?? dumpSnapshot)(
      config,
      url,
      manifest.snapshot,
      output,
    );
    manifest.databaseArchive = await fileDigest(
      join(output, "application.dump"),
    );
    summary.databaseBackupComplete = true;
    const after = await scanDiskObjects(config.originalsRoot);
    manifest.storageInventory = compareDiskInventories(before, after);
    summary.snapshotInventoryChanged = manifest.storageInventory.changed;
    fresh = new Client(options);
    await fresh.connect();
    await fresh.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await fresh.query(SESSION);
    if ((await assertFrozenTarget(fresh)) !== frozenAt)
      throw Error("target_freeze_changed");
    const finalTables = await tableDigests(fresh);
    if (JSON.stringify(finalTables) !== JSON.stringify(manifest.tables))
      throw Error("target_database_changed");
    await fresh.query("COMMIT");
    if (summary.snapshotInventoryChanged) throw Error("disk_inventory_changed");
    summary.objectBackupComplete = true;
    await db.query("COMMIT");
    transaction = false;
    summary.complete = true;
  } catch (error) {
    summary.error = {
      code: /^[a-z_]{1,80}$/.test(error?.message ?? "")
        ? error.message
        : "target_backup_failed",
    };
    for (const key of ["missingRequiredObjects", "recordedUploadsMismatch"])
      if (Number.isSafeInteger(error?.[key]) && error[key] >= 0)
        summary[key] = error[key];
  } finally {
    if (transaction) await db.query("ROLLBACK").catch(() => {});
    await Promise.allSettled([db.end(), fresh?.end()]);
    await save(join(output, "manifest.json"), manifest);
    await save(join(output, "summary.json"), summary);
  }
  return {
    complete: summary.complete,
    tableCount: manifest.tables.length,
    verifiedObjects: summary.verifiedObjects,
    modelCalls: 0,
    ...(summary.error ? { error: summary.error.code } : {}),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((report) => {
      console.log(JSON.stringify(report));
      if (!report.complete) process.exitCode = 1;
    })
    .catch(() => {
      console.error("target_backup_preflight_failed");
      process.exitCode = 1;
    });
