import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createLocalDatabase } from "../src/localDatabase.js";
import { migrate } from "../src/migrate.js";
import { verifyPassword } from "../src/crypto.js";
import { buildManifest, applyManifest, type Manifest } from "./manifest.js";
const db = createLocalDatabase();
const password = randomBytes(20).toString("hex");
let manifest: Manifest;
beforeAll(async () => {
  await migrate(db);
  manifest = await buildManifest(password);
});
afterAll(() => db.close());
it("prepares exactly 30 teachers and one independent administrator with unique salted credentials", async () => {
  expect(manifest.accounts.filter((a) => a.role === "teacher")).toHaveLength(
    30,
  );
  expect(manifest.accounts.filter((a) => a.role === "admin")).toHaveLength(1);
  expect(new Set(manifest.accounts.map((a) => a.username)).size).toBe(31);
  expect(new Set(manifest.accounts.map((a) => a.passwordHash)).size).toBe(31);
  for (const account of manifest.accounts)
    expect(await verifyPassword(password, account.passwordHash)).toBe(true);
  expect(JSON.stringify(manifest)).not.toContain(password);
});
it("applies a batch once and exact replays preserve account rows", async () => {
  expect(await applyManifest(db, manifest)).toEqual({
    applied: true,
    teachers: 30,
    admins: 1,
  });
  const before = (
    await db.query("SELECT * FROM pilot_auth.accounts ORDER BY id")
  ).rows;
  expect(await applyManifest(db, manifest)).toEqual({
    applied: false,
    teachers: 30,
    admins: 1,
  });
  expect(
    (await db.query("SELECT * FROM pilot_auth.accounts ORDER BY id")).rows,
  ).toEqual(before);
  const changed = structuredClone(manifest);
  changed.accounts[0].displayName = "Changed";
  await expect(applyManifest(db, changed)).rejects.toThrow(
    "batch_manifest_mismatch",
  );
  expect(
    (await db.query("SELECT * FROM pilot_auth.accounts ORDER BY id")).rows,
  ).toEqual(before);
});
it("immutable hash trigger rejects even owner updates and runtime role cannot create accounts or alter hashes", async () => {
  await expect(
    db.query("UPDATE pilot_auth.accounts SET password_hash='replacement'"),
  ).rejects.toThrow("password_immutable");
  await db.exec("SET ROLE wj_auth_runtime");
  try {
    await expect(
      db.query("UPDATE pilot_auth.accounts SET password_hash=password_hash"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "INSERT INTO pilot_auth.accounts SELECT * FROM pilot_auth.accounts LIMIT 0",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("DELETE FROM pilot_auth.accounts")).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await db.exec("RESET ROLE");
  }
});
it("rejects malformed manifest fields and rolls back all rows on SQL failure", async () => {
  const empty = createLocalDatabase();
  await migrate(empty);
  try {
    await expect(
      applyManifest(empty, { ...manifest, password: "leak" }),
    ).rejects.toThrow("invalid_manifest");
    const invalid = structuredClone(manifest);
    invalid.accounts[30].id = invalid.accounts[0].id;
    await expect(applyManifest(empty, invalid)).rejects.toThrow(
      "invalid_manifest",
    );
    // Collision with an unrelated existing row forces a failure after batch insertion.
    await empty.query(
      "INSERT INTO pilot_auth.batches VALUES ('teacher-pilot-v1',$1,now())",
      ["a".repeat(64)],
    );
    await expect(applyManifest(empty, manifest)).rejects.toThrow(
      "batch_manifest_mismatch",
    );
    expect(
      (await empty.query("SELECT * FROM pilot_auth.accounts")).rows,
    ).toHaveLength(0);
    await empty.exec(
      "DELETE FROM pilot_auth.batches; CREATE FUNCTION pilot_auth.fail_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.role='admin' THEN RAISE EXCEPTION 'synthetic_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_seed BEFORE INSERT ON pilot_auth.accounts FOR EACH ROW EXECUTE FUNCTION pilot_auth.fail_seed();",
    );
    await expect(applyManifest(empty, manifest)).rejects.toThrow(
      "synthetic_failure",
    );
    expect(
      (await empty.query("SELECT * FROM pilot_auth.accounts")).rows,
    ).toHaveLength(0);
    expect(
      (await empty.query("SELECT * FROM pilot_auth.batches")).rows,
    ).toHaveLength(0);
  } finally {
    await empty.close();
  }
});
it("refuses to call an incomplete existing batch a successful replay", async () => {
  const partial = createLocalDatabase();
  await migrate(partial);
  try {
    await applyManifest(partial, manifest);
    await partial.query("DELETE FROM pilot_auth.accounts WHERE id=$1", [
      manifest.accounts[0].id,
    ]);
    await expect(applyManifest(partial, manifest)).rejects.toThrow(
      "batch_integrity_failed",
    );
    expect(
      (await partial.query("SELECT * FROM pilot_auth.accounts")).rows,
    ).toHaveLength(30);
  } finally {
    await partial.close();
  }
});
