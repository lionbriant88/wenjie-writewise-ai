import type { Database } from "../src/database.js";
import { randomBytes, randomUUID } from "node:crypto";
import { digest, hashPassword, hashPattern } from "../src/crypto.js";
export interface SeedAccount {
  id: string;
  username: string;
  displayName: string;
  role: "teacher" | "admin";
  passwordHash: string;
}
export interface Manifest {
  version: "pilot-accounts-v1";
  batchId: "teacher-pilot-v1";
  accounts: SeedAccount[];
}
export async function buildManifest(password: string): Promise<Manifest> {
  if (
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 256 ||
    /[\r\n\t\0]/.test(password)
  )
    throw Error("invalid_initial_password");
  const accounts: SeedAccount[] = [];
  for (let index = 0; index < 31; index++)
    accounts.push({
      id: randomUUID(),
      username: `wj_${randomBytes(12).toString("hex")}`,
      displayName:
        index === 30
          ? "账号管理员"
          : `教师${String(index + 1).padStart(2, "0")}`,
      role: index === 30 ? "admin" : "teacher",
      passwordHash: await hashPassword(password),
    });
  return {
    version: "pilot-accounts-v1",
    batchId: "teacher-pilot-v1",
    accounts,
  };
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === keys.sort().join(",");
}
export function validateManifest(input: unknown): Manifest {
  const invalid = () => {
    throw Error("invalid_manifest");
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const value = input as Record<string, unknown>;
  if (
    !exactKeys(value, ["version", "batchId", "accounts"]) ||
    value.version !== "pilot-accounts-v1" ||
    value.batchId !== "teacher-pilot-v1" ||
    !Array.isArray(value.accounts) ||
    value.accounts.length !== 31
  )
    return invalid();
  for (const account of value.accounts) {
    if (
      !account ||
      typeof account !== "object" ||
      Array.isArray(account) ||
      !exactKeys(account, [
        "id",
        "username",
        "displayName",
        "role",
        "passwordHash",
      ])
    )
      return invalid();
    if (
      typeof account.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        account.id,
      ) ||
      typeof account.username !== "string" ||
      !/^wj_[0-9a-f]{24}$/.test(account.username) ||
      typeof account.displayName !== "string" ||
      account.displayName.trim().length === 0 ||
      account.displayName.length > 80 ||
      /[\x00-\x1f\x7f]/.test(account.displayName) ||
      !["teacher", "admin"].includes(account.role) ||
      typeof account.passwordHash !== "string" ||
      !hashPattern.test(account.passwordHash)
    )
      return invalid();
  }
  const accounts = value.accounts as SeedAccount[];
  for (const key of ["id", "username", "passwordHash"] as const)
    if (new Set(accounts.map((a) => a[key])).size !== 31) return invalid();
  if (
    new Set(accounts.map((a) => a.passwordHash.split("$")[4])).size !== 31 ||
    accounts.filter((a) => a.role === "admin").length !== 1
  )
    return invalid();
  // Rebuild in canonical key order and account order for stable replay digests.
  return {
    version: "pilot-accounts-v1",
    batchId: "teacher-pilot-v1",
    accounts: accounts
      .map((a) => ({
        id: a.id,
        username: a.username,
        displayName: a.displayName,
        role: a.role,
        passwordHash: a.passwordHash,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export async function applyManifest(
  db: Database,
  input: unknown,
): Promise<{ applied: boolean; teachers: number; admins: number }> {
  const manifest = validateManifest(input);
  const checksum = digest(JSON.stringify(manifest));
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM pilot_auth.guard WHERE id=1 FOR UPDATE");
    const existing = (
      await tx.query<{ digest: string }>(
        "SELECT digest FROM pilot_auth.batches WHERE id=$1",
        [manifest.batchId],
      )
    ).rows[0];
    if (existing) {
      if (existing.digest !== checksum) throw Error("batch_manifest_mismatch");
      const rows = (
        await tx.query<{
          id: string;
          username: string;
          role: string;
          password_hash: string;
        }>(
          "SELECT id,username,role,password_hash FROM pilot_auth.accounts WHERE batch_id=$1 ORDER BY id",
          [manifest.batchId],
        )
      ).rows;
      if (
        rows.length !== 31 ||
        rows.some((row, index) => {
          const expected = manifest.accounts[index];
          return (
            row.id !== expected.id ||
            row.username !== expected.username ||
            row.role !== expected.role ||
            row.password_hash !== expected.passwordHash
          );
        })
      )
        throw Error("batch_integrity_failed");
      return { applied: false, teachers: 30, admins: 1 };
    }
    await tx.query(
      "INSERT INTO pilot_auth.batches (id,digest) VALUES ($1,$2)",
      [manifest.batchId, checksum],
    );
    for (const a of manifest.accounts)
      await tx.query(
        "INSERT INTO pilot_auth.accounts (id,batch_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          a.id,
          manifest.batchId,
          a.username,
          a.displayName,
          a.role,
          a.passwordHash,
        ],
      );
    return { applied: true, teachers: 30, admins: 1 };
  });
}
