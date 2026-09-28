import { expect, it } from "vitest";
import { assertRuntimePrivileges } from "../privileges.js";
import { migratePilot } from "./migrate.js";
import { ownerA, pilotTestDb } from "./testSupport.js";
it("doesNotBroadenAuthPrivilegesAndMigrationIsRepeatable", async () => {
  const db = await pilotTestDb();
  try {
    await migratePilot(db);
    expect(
      (await db.query("SELECT id FROM pilot_auth.accounts")).rows,
    ).toHaveLength(2);
    await db.exec("SET ROLE wj_auth_runtime");
    await expect(assertRuntimePrivileges(db)).resolves.toBeUndefined();
    await expect(
      db.query("UPDATE pilot_auth.accounts SET password_hash=$1 WHERE id=$2", [
        "forbidden",
        ownerA,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.exec("CREATE TABLE pilot_grading.forbidden(id int)"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.exec("SELECT * FROM pilot_grading.tasks"),
    ).resolves.toBeDefined();
  } finally {
    await db.close();
  }
});
