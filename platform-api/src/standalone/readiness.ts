import { constants } from "node:fs";
import {
  access,
  lstat,
  readFile,
  realpath,
  rename,
  statfs,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
export async function assertDiskAccessible(root: string): Promise<void> {
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()
  )
    throw Error("storage_not_ready");
  await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
}
export async function assertDiskReady(
  root: string,
  available?: (root: string) => Promise<number>,
): Promise<void> {
  await assertDiskAccessible(root);
  const bytes = available
    ? await available(root)
    : await statfs(root).then((s) => s.bavail * s.bsize);
  if (!Number.isFinite(bytes) || bytes < 10 * 1024 ** 3)
    throw Error("storage_not_ready");
}
export async function writeWorkerHeartbeat(file: string): Promise<void> {
  const temporary = file + "." + process.pid + ".tmp";
  await writeFile(
    temporary,
    JSON.stringify({ pid: process.pid, at: Date.now() }),
    { mode: 0o600 },
  );
  await rename(temporary, file);
}
export async function assertWorkerReady(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
    throw Error("worker_not_ready");
  const value = JSON.parse(await readFile(file, "utf8")) as {
    pid: number;
    at: number;
  };
  if (
    !Number.isInteger(value.pid) ||
    value.pid < 1 ||
    !Number.isSafeInteger(value.at) ||
    value.at > Date.now() + 5000 ||
    value.at < Date.now() - 75000
  )
    throw Error("worker_not_ready");
  process.kill(value.pid, 0);
}
