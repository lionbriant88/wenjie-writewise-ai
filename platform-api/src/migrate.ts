import { readFile } from "node:fs/promises";
export async function migrate(db: {
  exec(sql: string): Promise<unknown>;
}): Promise<void> {
  await db.exec(
    await readFile(
      new URL("./migrations/001_pilot_auth.sql", import.meta.url),
      "utf8",
    ),
  );
}
