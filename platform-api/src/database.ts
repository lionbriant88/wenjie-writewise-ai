import pg from "pg";
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Queryable {
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function createPostgresDatabase(
  connectionString: string,
  ca?: string,
): Database {
  // pg parses every URL query option after explicit settings. Strip those overrides
  // so TLS verification, bounded timeouts and pooler-safe settings cannot be weakened.
  const url = new URL(connectionString);
  url.search = "";
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 3,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  });
  pool.on("error", () => {
    /* Failed idle clients are discarded; never log database credentials. */
  });
  const query: Queryable["query"] = async (sql, params) =>
    await pool.query(sql, params);
  return {
    query,
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn({
          query: async (sql, params) => client.query(sql, params),
        });
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
