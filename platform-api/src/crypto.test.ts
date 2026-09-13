import { expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./crypto.js";
it("uses independent salts, verifies only the supplied password, and rejects malformed hashes", async () => {
  const password = randomBytes(18).toString("hex");
  const first = await hashPassword(password),
    second = await hashPassword(password);
  expect(first).toMatch(/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  expect(first).not.toBe(second);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword("incorrect", first)).toBe(false);
  expect(await verifyPassword(password, "bad")).toBe(false);
});
