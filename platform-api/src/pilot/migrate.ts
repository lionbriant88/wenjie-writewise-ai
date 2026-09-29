import { readFile } from "node:fs/promises";
export async function migratePilot(db: {
  exec(sql: string): Promise<unknown>;
}): Promise<void> {
  for (const name of [
    "002_pilot_grading.sql",
    "003_pilot_deliveries.sql",
    "004_pilot_migration_control.sql",
  ])
    await db.exec(
      await readFile(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
}
