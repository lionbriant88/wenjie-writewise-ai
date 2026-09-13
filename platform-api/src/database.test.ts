import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { assertRuntimePrivileges } from "./privileges.js";

it("installs private account tables and a restricted runtime role idempotently", async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    await migrate(db);
    const table = await db.query<{ name: string | null }>(
      "SELECT to_regclass('pilot_auth.accounts')::text AS name",
    );
    expect(table.rows[0].name).toBe("pilot_auth.accounts");
    const rights = await db.query<{ allowed: boolean }>(
      "SELECT has_schema_privilege('public','pilot_auth','USAGE') AS allowed",
    );
    expect(rights.rows[0].allowed).toBe(false);
    const grant = await db.query<{ allowed: boolean }>(
      "SELECT has_column_privilege('wj_auth_runtime','pilot_auth.accounts','password_hash','UPDATE') AS allowed",
    );
    expect(grant.rows[0].allowed).toBe(false);
  } finally {
    await db.close();
  }
});
it("fails runtime privilege checks for owner but accepts the restricted role", async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    await expect(assertRuntimePrivileges(db)).rejects.toThrow(
      "unsafe_database_role",
    );
    await db.exec("SET ROLE wj_auth_runtime");
    await expect(assertRuntimePrivileges(db)).resolves.toBeUndefined();
  } finally {
    await db.close();
  }
});
it("revokes inherited data API grants for Supabase anon and authenticated roles", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await migrate(db);
    await db.exec(
      "GRANT USAGE ON SCHEMA pilot_auth TO anon,authenticated; GRANT ALL ON ALL TABLES IN SCHEMA pilot_auth TO anon,authenticated;",
    );
    await migrate(db);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(
        db.query("SELECT * FROM pilot_auth.accounts"),
      ).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE");
    }
  } finally {
    await db.close();
  }
});
