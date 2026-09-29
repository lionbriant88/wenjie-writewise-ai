import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
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
  /** One checked-out backend; callback must await every use. No transaction is implicit. */
  withConnection?<T>(
    fn: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T>;
}
export interface DatabaseConnection extends Queryable {
  readonly signal: AbortSignal;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
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
  const withConnection: NonNullable<Database["withConnection"]> = async (
    fn,
  ) => {
    const client = await pool.connect();
    const lost = new AbortController();
    let closed = false,
      discard = false,
      tail: Promise<unknown> = Promise.resolve();
    const transactionContext = new AsyncLocalStorage<{ active: boolean }>();
    const poison = () => lost.abort();
    client.on("error", poison);
    client.on("end", poison);
    const alive = () => {
      if (closed || lost.signal.aborted)
        throw Error("database_connection_lost");
    };
    const raw: Queryable["query"] = async (sql, params) => {
      alive();
      try {
        return await client.query(sql, params);
      } catch (error) {
        // SQL errors leave the session usable; transport/fatal failures do not.
        const { code, severity } = error as {
          code?: string;
          severity?: string;
        };
        if (
          !code ||
          !/^[0-9A-Z]{5}$/.test(code) ||
          code.startsWith("08") ||
          ["57P01", "57P02", "57P03"].includes(code) ||
          severity === "FATAL" ||
          severity === "PANIC"
        )
          poison();
        throw error;
      }
    };
    const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = tail.then(() => {
        alive();
        return operation();
      });
      tail = result.catch(() => {});
      return result;
    };
    const connection: DatabaseConnection = {
      signal: lost.signal,
      query: async (sql, params) => {
        const tx = transactionContext.getStore();
        if (tx && !tx.active) throw Error("database_transaction_closed");
        return tx ? raw(sql, params) : enqueue(() => raw(sql, params));
      },
      transaction: async (callback) => {
        if (transactionContext.getStore())
          throw Error("nested_database_transaction");
        return enqueue(async () => {
          const context = { active: true };
          await raw("BEGIN");
          try {
            const result = await transactionContext.run(context, () =>
              callback(connection),
            );
            context.active = false;
            await raw("COMMIT");
            return result;
          } catch (error) {
            context.active = false;
            if (!lost.signal.aborted) {
              try {
                await raw("ROLLBACK");
              } catch {
                poison();
              }
            }
            throw error;
          }
        });
      },
    };
    try {
      return await fn(connection);
    } catch (error) {
      discard = true;
      throw error;
    } finally {
      await tail;
      closed = true;
      client.removeListener("error", poison);
      client.removeListener("end", poison);
      // Failed callbacks can have acquired session locks; never return those
      // sessions to the pool, even if the wire connection remains healthy.
      client.release(discard || lost.signal.aborted);
    }
  };
  return {
    query,
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
    withConnection,
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
