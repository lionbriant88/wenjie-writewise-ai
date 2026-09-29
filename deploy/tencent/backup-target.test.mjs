import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  link,
  symlink,
  rm,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  historicalTables,
  migratedTables,
  validateBackupInventory,
  scanDiskObjects,
  compareDiskInventories,
  verifyUploadObjects,
  sha,
  within,
} from "./backup-support.mjs";
import {
  validateTargetConfig,
  assertFrozenTarget,
  main,
} from "./backup-target.mjs";
globalThis.fetch = () => {
  throw Error("network_forbidden_in_backup_tests");
};
let checks = 0,
  symlinkChecksSkipped = 0;
const config = {
  format: "writewise-target-backup-config-v1",
  databaseUrl: "postgres://synthetic:synthetic@127.0.0.1:5432/writewise_pilot",
  expected: {
    host: "127.0.0.1",
    port: 5432,
    database: "writewise_pilot",
    user: "synthetic",
  },
  caFile: resolve("ca.pem"),
  originalsRoot: resolve("originals"),
  pgBin: resolve("pg-bin"),
};
assert.equal(validateTargetConfig(config).expected.database, "writewise_pilot");
checks++;
for (const mutation of [
  {
    ...config,
    databaseUrl: config.databaseUrl.replace("127.0.0.1", "cloud.example"),
  },
  { ...config, databaseUrl: config.databaseUrl + "?sslmode=disable" },
  { ...config, expected: { ...config.expected, database: "postgres" } },
  { ...config, expected: { ...config.expected, user: "other" } },
  { ...config, expected: { ...config.expected, port: 6543 } },
  { ...config, caFile: "relative.pem" },
]) {
  assert.throws(() => validateTargetConfig(mutation));
  checks++;
}
await assert.rejects(main([]), /explicit_target_backup_arguments_required/);
checks++;
assert.equal(validateBackupInventory(historicalTables).tableCount, 22);
assert.equal(validateBackupInventory(migratedTables, "disk").tableCount, 25);
for (const tables of [
  historicalTables,
  migratedTables.slice(1),
  [...migratedTables, migratedTables[0]],
  [...migratedTables.slice(1), { schema: "pilot_auth", name: "unexpected" }],
])
  assert.throws(() => validateBackupInventory(tables, "disk"));
checks += 6;
const frozen = {
  frozen: true,
  frozen_at: "synthetic",
  admissions: 0,
  executions: 0,
  unsettled: 0,
  occupied: 0,
};
assert.equal(
  await assertFrozenTarget({ query: async () => ({ rows: [frozen] }) }),
  "synthetic",
);
checks++;
for (const [key, value] of [
  ["frozen", false],
  ["admissions", 1],
  ["executions", 1],
  ["unsettled", 1],
  ["occupied", 1],
]) {
  await assert.rejects(
    assertFrozenTarget({
      query: async () => ({ rows: [{ ...frozen, [key]: value }] }),
    }),
    /frozen_drained_target_required/,
  );
  checks++;
}
const fixture = await mkdtemp(join(tmpdir(), "writewise-backup-offline-"));
assert.ok(within(tmpdir(), fixture));
try {
  const root = join(fixture, "originals"),
    output = join(fixture, "backup");
  await mkdir(root);
  await mkdir(output);
  await mkdir(join(output, "objects"));
  const folder = randomUUID(),
    name = randomUUID(),
    path = folder + "/" + name;
  await mkdir(join(root, folder));
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(root, folder, name), bytes);
  const copied = await scanDiskObjects(root, { outputDirectory: output });
  assert.equal(copied.length, 1);
  assert.equal(copied[0].sha256, sha(bytes));
  assert.deepEqual(await readFile(join(output, copied[0].file)), bytes);
  checks++;
  const upload = {
    path,
    state: "attached",
    mime_type: "image/png",
    size: bytes.length,
    sha256: sha(bytes),
    essayReference: true,
    purged_at: null,
  };
  assert.equal(verifyUploadObjects([upload], copied).verifiedObjects, 1);
  checks++;
  for (const [uploads, objects] of [
    [[upload], []],
    [[{ ...upload, sha256: "wrong" }], copied],
    [[{ ...upload, purged_at: "synthetic" }], copied],
    [[], copied],
    [[upload, upload], copied],
  ]) {
    assert.throws(() => verifyUploadObjects(uploads, objects));
    checks++;
  }
  assert.equal(
    verifyUploadObjects(
      [{ ...upload, state: "reserved", essayReference: false, sha256: null }],
      [],
    ).verifiedObjects,
    0,
  );
  checks++;
  assert.equal(
    compareDiskInventories(copied, await scanDiskObjects(root)).changed,
    false,
  );
  checks++;
  await writeFile(
    join(root, folder, name),
    Buffer.concat([bytes, Buffer.from([0])]),
  );
  assert.equal(
    compareDiskInventories(copied, await scanDiskObjects(root)).changed,
    true,
  );
  checks++;
  await assert.rejects(
    scanDiskObjects(root, { maxBytes: 1 }),
    /backup_byte_limit/,
  );
  await assert.rejects(
    scanDiskObjects(root, { maxObjects: 0 }),
    /backup_inventory_limit/,
  );
  checks += 2;
  await assert.rejects(
    scanDiskObjects(root, { outputDirectory: join(root, "backup") }),
    /overlapping_backup_directory/,
  );
  checks++;
  const hardlink = join(root, folder, randomUUID());
  await link(join(root, folder, name), hardlink);
  await assert.rejects(scanDiskObjects(root), /unsafe_backup_object/);
  await rm(hardlink);
  checks++;
  await truncate(join(root, folder, name), 8388609);
  await assert.rejects(scanDiskObjects(root), /unsafe_backup_object/);
  await writeFile(join(root, folder, name), bytes);
  checks++;
  const pending = join(root, folder, ".pending-" + randomUUID());
  await writeFile(pending, bytes);
  await assert.rejects(scanDiskObjects(root), /unsafe_backup_object_entry/);
  await rm(pending);
  checks++;
  const external = join(fixture, "external");
  await mkdir(external);
  const linked = join(root, randomUUID());
  try {
    await symlink(
      external,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      scanDiskObjects(root),
      /unsafe_backup_directory_entry/,
    );
    await rm(linked);
    checks++;
  } catch (error) {
    if (error.code === "EPERM") symlinkChecksSkipped++;
    else throw error;
  }
  // Full orchestration with fake SQL/dump proves snapshot propagation and
  // fail-closed artifact preservation without opening a network connection.
  const caFile = join(fixture, "ca.pem");
  await writeFile(
    caFile,
    "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
  );
  const configuration = join(fixture, "config.json");
  await writeFile(
    configuration,
    JSON.stringify({ ...config, caFile, originalsRoot: root }),
    { mode: 0o600 },
  );
  let badInventory = false,
    changedDatabase = false,
    connections = 0,
    snapshotSeen = false;
  class FakeClient {
    constructor() {
      this.index = connections++;
    }
    async connect() {}
    async end() {}
    async query(sql) {
      if (sql.includes("current_database() AS database"))
        return {
          rows: [
            {
              database: config.expected.database,
              role: config.expected.user,
              host: "127.0.0.1",
              port: 5432,
              version: "170011",
              tls: true,
            },
          ],
        };
      if (sql.includes("FROM pilot_grading.migration_control c"))
        return { rows: [frozen] };
      if (sql === "SELECT pg_export_snapshot() AS snapshot")
        return { rows: [{ snapshot: "00000001-00000001-1" }] };
      if (sql.includes("FROM pg_tables"))
        return {
          rows: badInventory ? migratedTables.slice(1) : migratedTables,
        };
      if (sql.startsWith("FETCH")) {
        if (changedDatabase && this.index % 2 === 1 && !this.returned) {
          this.returned = true;
          return { rows: [{ value: '{"synthetic":"changed"}' }] };
        }
        return { rows: [] };
      }
      if (sql.startsWith("SELECT to_jsonb(u)"))
        return { rows: [{ record: upload, essayReference: true }] };
      return { rows: [] };
    }
  }
  const dump = async (_config, _url, snapshot, directory) => {
    assert.equal(snapshot, "00000001-00000001-1");
    snapshotSeen = true;
    await writeFile(join(directory, "application.dump"), "PGDMPsynthetic");
  };
  const successOutput = join(fixture, "success");
  const success = await main(
    ["--config", configuration, "--output", successOutput],
    { Client: FakeClient, dumpSnapshot: dump },
  );
  assert.equal(success.complete, true);
  assert.equal(snapshotSeen, true);
  checks++;
  assert.equal(
    JSON.parse(await readFile(join(successOutput, "manifest.json"), "utf8"))
      .source.storageBackend,
    "disk",
  );
  checks++;
  await assert.rejects(
    main(["--config", configuration, "--output", successOutput], {
      Client: FakeClient,
      dumpSnapshot: dump,
    }),
  );
  checks++;
  const incompleteOutput = join(fixture, "incomplete");
  badInventory = true;
  const incomplete = await main(
    ["--config", configuration, "--output", incompleteOutput],
    { Client: FakeClient, dumpSnapshot: dump },
  );
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.error, "unexpected_application_tables");
  assert.equal(
    JSON.parse(await readFile(join(incompleteOutput, "summary.json"), "utf8"))
      .complete,
    false,
  );
  checks++;
  badInventory = false;
  connections = 0;
  changedDatabase = true;
  const changedOutput = join(fixture, "changed");
  assert.equal(
    (
      await main(["--config", configuration, "--output", changedOutput], {
        Client: FakeClient,
        dumpSnapshot: dump,
      })
    ).error,
    "target_database_changed",
  );
  assert.equal(
    (
      await readFile(join(changedOutput, "application.dump"), "utf8")
    ).startsWith("PGDMP"),
    true,
  );
  checks++;
  changedDatabase = false;
  connections = 0;
  const failedDump = join(fixture, "failed-dump");
  const failure = await main(
    ["--config", configuration, "--output", failedDump],
    {
      Client: FakeClient,
      dumpSnapshot: async () => {
        throw Error("synthetic_dump_failure");
      },
    },
  );
  assert.equal(failure.complete, false);
  assert.equal(failure.error, "synthetic_dump_failure");
  assert.equal(
    JSON.parse(await readFile(join(failedDump, "manifest.json"), "utf8"))
      .objects.length,
    1,
  );
  checks++;
  const changedDisk = join(fixture, "changed-disk");
  const diskFailure = await main(
    ["--config", configuration, "--output", changedDisk],
    {
      Client: FakeClient,
      dumpSnapshot: async (...args) => {
        await dump(...args);
        await writeFile(
          join(root, folder, name),
          Buffer.concat([bytes, Buffer.from([1])]),
        );
      },
    },
  );
  assert.equal(diskFailure.complete, false);
  assert.equal(diskFailure.error, "disk_inventory_changed");
  checks++;
} finally {
  const target = resolve(fixture);
  assert.ok(
    within(tmpdir(), target) && target.includes("writewise-backup-offline-"),
  );
  await rm(target, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    passed: true,
    offlineChecks: checks,
    symlinkChecksSkipped,
    networkCalls: 0,
    modelCalls: 0,
  }),
);
