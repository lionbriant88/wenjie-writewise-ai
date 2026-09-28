import { readFile } from "node:fs/promises";
export async function migratePilot(db: {
  exec(sql: string): Promise<unknown>;
}): Promise<void> {
  await db.exec(
    await readFile(
      new URL("../migrations/002_pilot_grading.sql", import.meta.url),
      "utf8",
    ),
  );
}
