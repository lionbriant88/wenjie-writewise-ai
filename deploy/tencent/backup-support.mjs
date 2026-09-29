import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

const baseline = {
  pilot_auth: [
    "accounts",
    "audit",
    "batches",
    "guard",
    "rate_limits",
    "sessions",
  ],
  pilot_grading: [
    "command_receipts",
    "essay_pages",
    "essay_sources",
    "essays",
    "executions",
    "grading_results",
    "job_uploads",
    "jobs",
    "maintenance_jobs",
    "outbox",
    "provider_gate",
    "task_material_uploads",
    "task_revisions",
    "tasks",
    "teacher_reviews",
    "uploads",
  ],
};
const names = (tables) => tables.map((t) => `${t.schema}.${t.name}`).sort();
export const historicalTables = Object.entries(baseline).flatMap(
  ([schema, list]) => list.map((name) => ({ schema, name })),
);
export const migratedTables = [
  ...historicalTables,
  ...["deliveries", "migration_control", "migration_admissions"].map(
    (name) => ({ schema: "pilot_grading", name }),
  ),
];
export function validateBackupInventory(tables, storageBackend = "supabase") {
  if (!Array.isArray(tables) || !["supabase", "disk"].includes(storageBackend))
    throw Error("unexpected_application_tables");
  const actual = JSON.stringify(names(tables));
  const version =
    actual === JSON.stringify(names(migratedTables))
      ? "migration-v1"
      : actual === JSON.stringify(names(historicalTables))
        ? "pilot-v1"
        : null;
  if (!version || (storageBackend === "disk" && version !== "migration-v1"))
    throw Error("unexpected_application_tables");
  return { version, storageBackend, tableCount: tables.length };
}
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const objectPathPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const folderPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function classifyUpload(upload, object) {
  const referenced =
    upload.materialReference || upload.essayReference || upload.jobReference;
  if (upload.purged_at)
    return {
      classification: object ? "purged_object_present" : "purged_absent",
      required: !!referenced,
      valid: !object && !referenced,
    };
  const required = !!referenced || upload.state !== "reserved";
  if (!object)
    return {
      classification: required ? "required_object_missing" : "reserved_absent",
      required,
      valid: !required,
    };
  if (object.downloadStatus !== "verified")
    return { classification: "object_download_failed", required, valid: false };
  const valid =
    object.size === upload.size &&
    object.contentType === upload.mime_type &&
    (!upload.sha256 || object.sha256 === upload.sha256) &&
    !(referenced && upload.state === "reserved");
  return {
    classification: valid
      ? upload.state === "reserved"
        ? "reserved_present"
        : "verified_present"
      : "upload_object_mismatch",
    required,
    valid,
  };
}
function equalPath(a, b) {
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}
export function within(parent, child) {
  const p = resolve(parent) + sep,
    c = resolve(child);
  return process.platform === "win32"
    ? c.toLowerCase().startsWith(p.toLowerCase())
    : c.startsWith(p);
}
export async function checkedDirectory(path) {
  if (!isAbsolute(path)) throw Error("absolute_private_directory_required");
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    !equalPath(await realpath(path), resolve(path))
  )
    throw Error("unsafe_private_directory");
}
function imageMime(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216)
    return "image/jpeg";
  if (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw Error("unsupported_backup_object");
}
async function readObject(root, path) {
  if (!objectPathPattern.test(path)) throw Error("unsafe_object_path");
  await checkedDirectory(root);
  await checkedDirectory(join(root, path.split("/")[0]));
  const filename = join(root, ...path.split("/")),
    before = await lstat(filename);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > 8388608
  )
    throw Error("unsafe_backup_object");
  const file = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await file.stat();
    if (
      !opened.isFile() ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size
    )
      throw Error("backup_object_changed");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const part = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!part.bytesRead) throw Error("backup_object_changed");
      offset += part.bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await file.read(extra, 0, 1, offset)).bytesRead)
      throw Error("backup_object_changed");
    const after = await file.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error("backup_object_changed");
    return bytes;
  } finally {
    await file.close();
  }
}
/** Bounded, raw-byte, no symlinks/hardlinks/temp entries. Frozen target only. */
export async function scanDiskObjects(
  root,
  { outputDirectory, maxBytes = 20 * 1024 ** 3, maxObjects = 200000 } = {},
) {
  await checkedDirectory(root);
  if (
    outputDirectory &&
    (within(root, outputDirectory) ||
      within(outputDirectory, root) ||
      equalPath(resolve(root), resolve(outputDirectory)))
  )
    throw Error("overlapping_backup_directory");
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > maxObjects) throw Error("backup_inventory_limit");
  const objects = [];
  let total = 0;
  for (const folder of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !folderPattern.test(folder.name) ||
      !folder.isDirectory() ||
      folder.isSymbolicLink()
    )
      throw Error("unsafe_backup_directory_entry");
    await checkedDirectory(join(root, folder.name));
    const files = await readdir(join(root, folder.name), {
      withFileTypes: true,
    });
    if (files.length + objects.length > maxObjects)
      throw Error("backup_inventory_limit");
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = folder.name + "/" + file.name;
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        !objectPathPattern.test(path)
      )
        throw Error("unsafe_backup_object_entry");
      const bytes = await readObject(root, path);
      total += bytes.length;
      if (total > maxBytes) throw Error("backup_byte_limit");
      const object = {
        path,
        size: bytes.length,
        sha256: sha(bytes),
        contentType: imageMime(bytes),
        downloadStatus: "verified",
      };
      if (outputDirectory) {
        object.file = "objects/" + randomUUID() + ".bin";
        await writeFile(join(outputDirectory, object.file), bytes, {
          flag: "wx",
          mode: 0o600,
        });
      }
      objects.push(object);
    }
  }
  return objects;
}
export function compareDiskInventories(before, after) {
  const fingerprint = (objects) =>
    JSON.stringify(
      objects
        .map(({ path, size, sha256, contentType }) => ({
          path,
          size,
          sha256,
          contentType,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    );
  return {
    snapshotCount: before.length,
    afterCount: after.length,
    changed: fingerprint(before) !== fingerprint(after),
  };
}
export function verifyUploadObjects(uploads, objects) {
  const byPath = new Map(objects.map((o) => [o.path, o])),
    uploadPaths = new Set();
  let missing = 0,
    mismatched = 0;
  for (const upload of uploads) {
    if (!objectPathPattern.test(upload.path) || uploadPaths.has(upload.path))
      throw Error("invalid_upload_inventory");
    uploadPaths.add(upload.path);
    const result = classifyUpload(upload, byPath.get(upload.path));
    if (!result.valid) mismatched++;
    if (result.required && !byPath.has(upload.path)) missing++;
  }
  if (objects.some((o) => !uploadPaths.has(o.path)))
    throw Error("unassociated_disk_object");
  if (missing || mismatched) {
    const error = Error("upload_object_mismatch");
    error.missingRequiredObjects = missing;
    error.recordedUploadsMismatch = mismatched;
    throw error;
  }
  return {
    missingRequiredObjects: missing,
    recordedUploadsMismatch: mismatched,
    verifiedObjects: objects.length,
  };
}
