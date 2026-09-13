import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable } from "./database.js";
export function createLocalDatabase(path?: string): Database {
  const db = new PGlite(path);
  return {
    query: async <T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ) => db.query<T>(sql, params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    transaction: (fn) => db.transaction((tx) => fn(tx as Queryable)),
  };
}
