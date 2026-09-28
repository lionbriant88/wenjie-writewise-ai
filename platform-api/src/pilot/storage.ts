import { createClient } from "@supabase/supabase-js";
import { MAX_RUBRIC_IMAGE_BYTES } from "../../../grading-gateway/src/multipartImages.js";
import { PilotError, invalid } from "./errors.js";
import { id } from "./validation.js";
export interface PrivateStorage {
  signUpload(path: string): Promise<{ url: string; expiresAt: string }>;
  read(
    path: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; contentType: string }>;
  signRead(path: string, ttlSeconds: number): Promise<string>;
  remove(paths: string[]): Promise<void>;
}
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.ok || !response.body)
    throw new PilotError("storage_unavailable", 503);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new PilotError("invalid_image");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PilotError("invalid_image");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
export function createPrivateStorage(
  config: { url: string; bucket: string; serviceKey: string },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): PrivateStorage {
  if (
    config.url !== "https://wudbhdyqgnbnuorebhnu.supabase.co" ||
    config.bucket !== "pilot-originals" ||
    !config.serviceKey
  )
    throw new PilotError("storage_not_configured", 503);
  const checkedPath = (path: string) => {
    const parts = path.split("/");
    if (parts.length !== 2 || parts.some((p) => id(p) !== p)) return invalid();
    return path;
  };
  const client = createClient(config.url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        if (new URL(String(input)).origin !== config.url)
          throw new PilotError("storage_unavailable", 503);
        return fetchImpl(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
      },
    },
  }).storage.from(config.bucket);
  const safeUrl = (value: string, path: string, upload = false) => {
    const url = new URL(value);
    if (
      url.origin !== config.url ||
      url.pathname !==
        `/storage/v1/object/${upload ? "upload/" : ""}sign/${config.bucket}/${path}` ||
      !url.searchParams.get("token")
    )
      throw new PilotError("storage_unavailable", 503);
    return url.href;
  };
  const signRead = async (path: string, ttlSeconds: number) => {
    checkedPath(path);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 60)
      return invalid();
    try {
      const { data, error } = await client.createSignedUrl(path, ttlSeconds);
      if (error || !data) throw Error();
      return safeUrl(data.signedUrl, path);
    } catch {
      throw new PilotError("storage_unavailable", 503);
    }
  };
  return {
    async signUpload(path) {
      checkedPath(path);
      try {
        const { data, error } = await client.createSignedUploadUrl(path, {
          upsert: false,
        });
        if (error || !data) throw Error();
        return {
          url: safeUrl(data.signedUrl, path, true),
          expiresAt: new Date(now() + 7200000).toISOString(),
        };
      } catch {
        throw new PilotError("storage_unavailable", 503);
      }
    },
    signRead,
    async read(path, signal) {
      const url = await signRead(path, 60);
      try {
        const response = await fetchImpl(url, {
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        });
        const bytes = await readBoundedBody(response, MAX_RUBRIC_IMAGE_BYTES);
        return {
          bytes,
          contentType:
            response.headers
              .get("content-type")
              ?.split(";")[0]
              .trim()
              .toLowerCase() ?? "",
        };
      } catch (error) {
        if (error instanceof PilotError) throw error;
        throw new PilotError("storage_unavailable", 503);
      }
    },
    async remove(paths) {
      if (paths.length > 50) return invalid();
      paths.forEach(checkedPath);
      try {
        const { error } = await client.remove(paths);
        if (error) throw Error();
      } catch {
        throw new PilotError("storage_unavailable", 503);
      }
    },
  };
}
