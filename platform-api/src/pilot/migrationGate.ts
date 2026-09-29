import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Database, DatabaseConnection } from "../database.js";
import { PilotError } from "./errors.js";
export interface MigrationGate {
  assertOpen(): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
  guardDatabase(db: Database): Database;
}
type Admission = {
  connection: DatabaseConnection;
  closed: boolean;
  pending: Set<Promise<unknown>>;
};
/**
 * run owns one SESSION advisory lock (1464486217, 1) and a committed admission
 * marker. It is intentionally not one long transaction: provider reservations
 * and results must commit independently. A dropped session leaves its marker,
 * preventing cutover even when PostgreSQL releases the advisory lock.
 *
 * Await the actual effects in run; never settle it on HTTP finish/close alone.
 * Nested run/guarded SQL reuse the backend and are drained even on parent error.
 * Detached work outside run cannot be protected. Use the guarded DB everywhere
 * (including auth before last_seen/limiter writes) and run for non-SQL effects.
 */
export function createMigrationGate(db: Database): MigrationGate {
  if (!db.withConnection)
    throw new PilotError("migration_connection_required", 503);
  const context = new AsyncLocalStorage<Admission>();
  const assertAlive = (admission: Admission) => {
    if (admission.connection.signal.aborted)
      throw new PilotError("migration_connection_lost", 503);
    if (admission.closed)
      throw new PilotError("migration_admission_closed", 503);
  };
  const gate: MigrationGate = {
    async assertOpen() {
      const existing = context.getStore();
      if (existing) {
        assertAlive(existing);
        return;
      }
      const row = (
        await db.query<{ frozen: boolean }>(
          "SELECT frozen FROM pilot_grading.migration_control WHERE singleton=true",
        )
      ).rows[0];
      if (!row || row.frozen !== false)
        throw new PilotError("migration_frozen", 503);
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const existing = context.getStore();
      if (existing) {
        assertAlive(existing);
        const result = Promise.resolve().then(() => {
          assertAlive(existing);
          return operation();
        });
        existing.pending.add(result);
        // Observe both branches without manufacturing an unhandled rejection.
        void result.then(
          () => existing.pending.delete(result),
          () => existing.pending.delete(result),
        );
        return result;
      }
      return db.withConnection!(async (connection) => {
        const token = randomUUID();
        const row = (
          await connection.query<{ admitted: boolean }>(
            "SELECT pilot_grading.enter_migration($1::uuid) AS admitted",
            [token],
          )
        ).rows[0];
        if (row?.admitted !== true)
          throw new PilotError("migration_frozen", 503);
        const admission: Admission = {
          connection,
          closed: false,
          pending: new Set(),
        };
        try {
          return await context.run(admission, async () => {
            assertAlive(admission);
            return operation();
          });
        } finally {
          // A request abort/rejection must not release a still-running child.
          while (admission.pending.size)
            await Promise.allSettled([...admission.pending]);
          assertAlive(admission);
          admission.closed = true;
          const released = (
            await connection.query<{ released: boolean }>(
              "SELECT pilot_grading.leave_migration($1::uuid) AS released",
              [token],
            )
          ).rows[0]?.released;
          if (released !== true)
            throw new PilotError("migration_release_failed", 503);
        }
      });
    },
    guardDatabase(target) {
      if (target !== db)
        throw new PilotError("migration_database_mismatch", 503);
      const admitted = () => {
        const admission = context.getStore();
        if (!admission)
          throw new PilotError("migration_admission_required", 503);
        assertAlive(admission);
        return admission.connection;
      };
      return {
        query: (sql, params) => gate.run(() => admitted().query(sql, params)),
        exec: (sql) => gate.run(() => admitted().query(sql)),
        transaction: (callback) =>
          gate.run(() => admitted().transaction(callback)),
        close: () => db.close(),
        withConnection: (callback) => gate.run(() => callback(admitted())),
      };
    },
  };
  return gate;
}
