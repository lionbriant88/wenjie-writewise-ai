import { createHmac, timingSafeEqual } from "node:crypto";
import { PilotError, invalid } from "./errors.js";
import { id } from "./validation.js";

export type FileMethod = "GET" | "PUT";
export const checkedFilePath = (path: string): string => {
  if (typeof path !== "string") return invalid();
  const parts = path.split("/");
  if (parts.length !== 2 || parts.some((part) => id(part) !== part))
    return invalid();
  return path;
};

export function createFileTickets(config: {
  origin: string;
  signingKey: string;
  now?: () => number;
}) {
  let origin: string;
  try {
    const url = new URL(config.origin);
    if (
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))
      ) ||
      url.origin !== config.origin ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return invalid();
    origin = url.origin;
  } catch {
    return invalid();
  }
  if (
    typeof config.signingKey !== "string" ||
    Buffer.byteLength(config.signingKey) < 32
  )
    return invalid();
  const now = config.now ?? Date.now;
  const mac = (method: FileMethod, path: string, expires: string) =>
    createHmac("sha256", config.signingKey)
      .update(`pilot-file-ticket-v1\n${method}\n${path}\n${expires}`, "utf8")
      .digest("hex");
  return {
    sign(method: FileMethod, path: string, ttlSeconds: number) {
      checkedFilePath(path);
      if (
        (method !== "GET" && method !== "PUT") ||
        !Number.isInteger(ttlSeconds) ||
        ttlSeconds < 1 ||
        ttlSeconds > (method === "GET" ? 60 : 7200)
      )
        return invalid();
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) return invalid();
      const expires = String(Math.floor(timestamp / 1000) + ttlSeconds);
      const signature = mac(method, path, expires);
      return {
        url: `${origin}/api/pilot/files/${path}?expires=${expires}&signature=${signature}`,
        expiresAt: new Date(Number(expires) * 1000).toISOString(),
      };
    },
    verify(
      method: FileMethod,
      path: string,
      expires: string,
      signature: string,
    ): void {
      checkedFilePath(path);
      if (
        (method !== "GET" && method !== "PUT") ||
        typeof expires !== "string" ||
        !/^[1-9][0-9]*$/.test(expires) ||
        typeof signature !== "string" ||
        !/^[a-f0-9]{64}$/.test(signature)
      )
        throw new PilotError("invalid_ticket", 403);
      const deadline = Number(expires);
      const timestamp = now();
      if (
        !Number.isSafeInteger(deadline) ||
        !Number.isSafeInteger(timestamp) ||
        timestamp < 0 ||
        timestamp >= deadline * 1000 ||
        deadline - Math.floor(timestamp / 1000) > (method === "GET" ? 60 : 7200)
      )
        throw new PilotError("invalid_ticket", 403);
      const actual = Buffer.from(signature, "hex");
      const expected = Buffer.from(mac(method, path, expires), "hex");
      if (!timingSafeEqual(actual, expected))
        throw new PilotError("invalid_ticket", 403);
    },
  };
}
