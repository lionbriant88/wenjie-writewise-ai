import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
export const hashPattern = /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (!hashPattern.test(encoded)) return false;
  const parts = encoded.split("$");
  return timingSafeEqual(
    await derive(password, Buffer.from(parts[4], "hex")),
    Buffer.from(parts[5], "hex"),
  );
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const keyedDigest = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("hex");
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
