import {
  mkdir,
  readdir,
  readFile,
  copyFile,
  cp,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function validateRelease(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))
    throw Error("invalid_release");
  return value;
}
export function releaseFiles(files) {
  return files.filter(
    (file) =>
      /^(platform-api\/src|platform-api\/scripts|grading-gateway\/src|app\/src|shared)\/.*\.js$/.test(
        file,
      ) &&
      !/(\.test\.js$|(?:^|\/)(?:workerTestSupport|testSupport)\.js$|(?:^|\/)(?:node_modules|local-private-[^/]+)\/)/.test(
        file,
      ),
  );
}
async function filesIn(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error("artifact_symlink");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await filesIn(path)));
    else out.push(path);
  }
  return out;
}
function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit", shell: false });
}
export async function build(release, offline = false) {
  validateRelease(release);
  const output = join(root, "build", "tencent", release);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Never overwrite evidence/release.
  run(process.execPath, [
    join(root, "platform-api/node_modules/typescript/bin/tsc"),
    "-p",
    join(root, "platform-api/tsconfig.standalone.json"),
    "--outDir",
    output,
  ]);
  const emitted = (await filesIn(output)).map((file) =>
    relative(output, file).split(sep).join("/"),
  );
  if (releaseFiles(emitted).length !== emitted.length)
    throw Error("unexpected_emitted_file");
  await writeFile(
    join(output, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  for (const pkg of ["platform-api", "grading-gateway"]) {
    for (const file of ["package.json", "package-lock.json"])
      await copyFile(join(root, pkg, file), join(output, pkg, file));
    // Install from the exact lock, never copy a developer's node_modules/config.
    // npm's executable script is located relative to the active Node runtime.
    const npm = process.env.npm_execpath;
    if (!npm) throw Error("run_build_via_npm");
    run(
      process.execPath,
      [
        npm,
        "ci",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...(offline ? ["--offline"] : []),
      ],
      join(output, pkg),
    );
  }
  const migrations = join(output, "platform-api/src/migrations");
  await mkdir(migrations);
  for (const file of [
    "001_pilot_auth.sql",
    "002_pilot_grading.sql",
    "003_pilot_deliveries.sql",
    "004_pilot_migration_control.sql",
  ])
    await copyFile(
      join(root, "platform-api/src/migrations", file),
      join(migrations, file),
    );
  run(
    process.execPath,
    [process.env.npm_execpath, "run", "build"],
    join(root, "app"),
  );
  await cp(join(root, "app/dist"), join(output, "public"), { recursive: true });
  await mkdir(join(output, "deploy/tencent"), { recursive: true });
  for (const file of [
    "install.sh",
    "nginx.conf",
    "writewise-api.service",
    "writewise-worker.service",
    "writewise-maintenance.service",
    "writewise-maintenance.timer",
    "runtime.env.example",
    "README.md",
    "MIGRATION.md",
    "backup-target.mjs",
    "backup-support.mjs",
    "backup-restore.md",
  ])
    await copyFile(
      join(root, "deploy/tencent", file),
      join(output, "deploy/tencent", file),
    );
  const inventory = { release, files: [] };
  for (const file of (await filesIn(output)).sort()) {
    const name = relative(output, file).split(sep).join("/");
    if (/(?:^|\/)(?:\.env(?:\.|$)|local-private-|\.git(?:\/|$))/.test(name))
      throw Error("private_file_in_artifact");
    const bytes = await readFile(file);
    inventory.files.push({
      path: name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(
    join(output, "release-manifest.json"),
    JSON.stringify(inventory, null, 2),
  );
  // Resource/import smoke tests run emitted JS, without a DB or provider call.
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m=await import('./platform-api/src/pilot/migrate.js');let n=0;await m.migratePilot({exec:async()=>{n++}});if(n!==3)throw Error('migrations');await import('./platform-api/src/runtime.js');await import('./platform-api/src/standalone/worker.js');await import('./platform-api/scripts/migrationControl.js');await import('./platform-api/scripts/queueHandoff.js');await import('./deploy/tencent/backup-target.mjs');console.log('standalone_artifact_imports_ok')`,
    ],
    output,
  );
  run("tar", ["-czf", output + ".tgz", "-C", dirname(output), release]);
  console.log("standalone_release_built " + release);
  return output;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const release = process.argv[2];
  if (!release || process.argv.slice(3).some((arg) => arg !== "--offline"))
    throw Error("usage: npm run build:standalone -- RELEASE [--offline]");
  await build(release, process.argv.includes("--offline"));
}
