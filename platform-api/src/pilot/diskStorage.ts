import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  statfs,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MAX_RUBRIC_IMAGE_BYTES } from "../../../grading-gateway/src/multipartImages.js";
import { readSafeImageDimensions } from "../../../grading-gateway/src/imageMetadata.js";
import { PilotError, invalid } from "./errors.js";
import {
  checkedFilePath,
  createFileTickets,
  type FileMethod,
} from "./fileTickets.js";
import type { PrivateStorage } from "./storage.js";

const MIN_FREE_BYTES = 10 * 1024 ** 3;
type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export interface DiskStorage extends PrivateStorage {
  put(
    path: string,
    stream: AsyncIterable<Uint8Array>,
    expected: { size: number; contentType: string },
    signal: AbortSignal,
  ): Promise<void>;
  verifyTicket(
    method: FileMethod,
    path: string,
    expires: string,
    signature: string,
  ): void;
}
export interface DiskStorageConfig {
  root: string;
  origin: string;
  signingKey: string;
  now?: () => number;
  freeBytes?: (root: string) => Promise<number>;
}

function mimeFromBytes(bytes: Buffer): ImageMime | null {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return "image/jpeg";
  if (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
function checkedImage(bytes: Buffer, claimed?: string): ImageMime {
  const mime = mimeFromBytes(bytes);
  if (
    !mime ||
    (claimed !== undefined && claimed !== mime) ||
    readSafeImageDimensions(bytes, mime).status !== "known"
  )
    throw new PilotError("invalid_image");
  return mime;
}
function safeError(error: unknown): never {
  if (error instanceof PilotError) throw error;
  throw new PilotError("storage_unavailable", 503);
}
function aborted(): never {
  throw new PilotError("storage_unavailable", 503);
}
async function nextOrAbort(
  iterator: AsyncIterator<Uint8Array>,
  signal: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
  if (signal.aborted) return aborted();
  let onAbort!: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => reject(new PilotError("storage_unavailable", 503));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    if (signal.aborted) return aborted();
    return await Promise.race([
      Promise.resolve().then(() => iterator.next()),
      cancellation,
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
function stopIterator(iterator: AsyncIterator<Uint8Array>): void {
  try {
    // A source may never settle its pending next()/return(); cleanup must not wait.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  } catch {
    // The upload's filesystem cleanup still runs for a broken source.
  }
}

export function createDiskStorage(config: DiskStorageConfig): DiskStorage {
  if (!config.root || !isAbsolute(config.root)) return invalid();
  const root = resolve(config.root);
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const staticRoots = [
    resolve(repositoryRoot, "app", "dist"),
    resolve(repositoryRoot, "platform-api", "dist"),
    resolve(repositoryRoot, "public"),
  ];
  if (
    staticRoots.some(
      (staticRoot) => root === staticRoot || root.startsWith(staticRoot + sep),
    )
  )
    return invalid();
  const tickets = createFileTickets(config);
  let pendingBytes = 0;
  const available =
    config.freeBytes ??
    (async (directory: string) => {
      const disk = await statfs(directory);
      return disk.bavail * disk.bsize;
    });
  async function checkedDirectory(path: string, create = false) {
    const [folder, filename] = checkedFilePath(path).split("/");
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      (await realpath(root)).toLowerCase() !== root.toLowerCase()
    )
      return invalid();
    const directory = join(root, folder);
    if (create)
      await mkdir(directory, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    const dirInfo = await lstat(directory);
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) return invalid();
    return { directory, filename, target: join(directory, filename) };
  }
  return {
    signUpload: async (path) => tickets.sign("PUT", path, 7200),
    signRead: async (path, ttlSeconds) =>
      tickets.sign("GET", path, ttlSeconds).url,
    verifyTicket: tickets.verify,
    async put(path, stream, expected, signal) {
      checkedFilePath(path);
      if (
        !Number.isSafeInteger(expected.size) ||
        expected.size < 1 ||
        expected.size > MAX_RUBRIC_IMAGE_BYTES ||
        !["image/png", "image/jpeg", "image/webp"].includes(
          expected.contentType,
        )
      )
        return invalid();
      let temporary: string | undefined;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let iterator: AsyncIterator<Uint8Array> | undefined;
      let streamComplete = false;
      let reserved = false;
      try {
        const { directory, target } = await checkedDirectory(path, true);
        const free = await available(root);
        if (
          !Number.isFinite(free) ||
          free - pendingBytes - expected.size < MIN_FREE_BYTES
        )
          throw new PilotError("storage_unavailable", 503);
        pendingBytes += expected.size;
        reserved = true;
        temporary = join(directory, `.pending-${randomUUID()}`);
        handle = await open(
          temporary,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        let size = 0;
        iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const next = await nextOrAbort(iterator, signal);
          if (next.done) {
            streamComplete = true;
            break;
          }
          const chunk = next.value;
          if (signal.aborted) return aborted();
          if (
            !(chunk instanceof Uint8Array) ||
            size + chunk.byteLength > expected.size ||
            size + chunk.byteLength > MAX_RUBRIC_IMAGE_BYTES
          )
            throw new PilotError("invalid_image");
          let offset = 0;
          while (offset < chunk.byteLength) {
            const { bytesWritten } = await handle.write(
              chunk,
              offset,
              chunk.byteLength - offset,
              size + offset,
            );
            if (bytesWritten === 0) throw new Error("short write");
            offset += bytesWritten;
          }
          size += chunk.byteLength;
        }
        if (signal.aborted) return aborted();
        if (size !== expected.size) throw new PilotError("invalid_image");
        await handle.sync();
        const image = await (async () => {
          const reader = await open(
            temporary!,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
          );
          try {
            return await reader.readFile();
          } finally {
            await reader.close();
          }
        })();
        checkedImage(image, expected.contentType);
        await handle.close();
        handle = undefined;
        await checkedDirectory(path);
        if (signal.aborted) return aborted();
        // Successful linking commits publication: concurrent readers may already
        // have confirmed these bytes, so later cancellation must not remove them.
        await link(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
          throw new PilotError("upload_exists", 409);
        safeError(error);
      } finally {
        if (iterator && !streamComplete) stopIterator(iterator);
        if (reserved) pendingBytes -= expected.size;
        if (handle) await handle.close().catch(() => undefined);
        if (temporary) await unlink(temporary).catch(() => undefined);
      }
    },
    async read(path, signal) {
      try {
        const { target } = await checkedDirectory(path);
        if (signal.aborted) throw new PilotError("storage_unavailable", 503);
        const targetInfo = await lstat(target);
        if (!targetInfo.isFile() || targetInfo.isSymbolicLink())
          return invalid();
        const file = await open(
          target,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const info = await file.stat();
          if (
            !info.isFile() ||
            info.size < 1 ||
            info.size > MAX_RUBRIC_IMAGE_BYTES
          )
            throw new PilotError("invalid_image");
          const bytes = await file.readFile();
          if (signal.aborted) throw new PilotError("storage_unavailable", 503);
          return { bytes, contentType: checkedImage(bytes) };
        } finally {
          await file.close();
        }
      } catch (error) {
        safeError(error);
      }
    },
    async remove(paths) {
      if (paths.length > 50) return invalid();
      paths.forEach(checkedFilePath);
      for (const path of paths) {
        try {
          const { target } = await checkedDirectory(path);
          const info = await lstat(target);
          if (!info.isFile() || info.isSymbolicLink()) return invalid();
          await unlink(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
          safeError(error);
        }
      }
    },
  };
}
