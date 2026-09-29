import { expect, it } from "vitest";
import type { Database, Queryable } from "../database.js";
import { createMigrationGate } from "./migrationGate.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
// A connection/lock transport double, not evidence of real PostgreSQL contention.
// Unknown SQL fails; observable effects and safety markers are tested below.
function fixture() {
  let frozen = false,
    effects = 0,
    connections = 0;
  const admissions = new Map<string, number>();
  const losses: AbortController[] = [];
  const execute = async (sql: string, params: unknown[] = [], backend = 0) => {
    if (sql.includes("enter_migration")) {
      if (frozen) return { rows: [{ admitted: false }] };
      admissions.set(String(params[0]), backend);
      return { rows: [{ admitted: true }] };
    }
    if (sql.includes("leave_migration")) {
      const id = String(params[0]);
      const released = admissions.get(id) === backend;
      if (released) admissions.delete(id);
      return { rows: [{ released }] };
    }
    if (sql.includes("migration_control")) return { rows: [{ frozen }] };
    if (sql === "effect") {
      effects++;
      return { rows: [] };
    }
    throw Error("unexpected_test_sql");
  };
  const db: Database = {
    query: execute as Queryable["query"],
    exec: execute,
    transaction: async (fn) => fn({ query: execute as Queryable["query"] }),
    close: async () => {},
    withConnection: async (fn) => {
      const backend = ++connections,
        loss = new AbortController();
      losses.push(loss);
      const query: Queryable["query"] = async (sql, params) => {
        if (loss.signal.aborted) throw Error("connection_lost");
        return execute(sql, params, backend) as never;
      };
      return fn({
        query,
        signal: loss.signal,
        transaction: async (callback) => callback({ query }),
      });
    },
  };
  return {
    db,
    admissions,
    losses,
    freeze: () => {
      frozen = true;
    },
    effects: () => effects,
    connections: () => connections,
  };
}

it("rejects frozen ordinary queries and transactions before their effects", async () => {
  const f = fixture(),
    gate = createMigrationGate(f.db),
    db = gate.guardDatabase(f.db);
  f.freeze();
  await expect(db.query("effect")).rejects.toMatchObject({
    code: "migration_frozen",
  });
  await expect(
    db.transaction((tx) => tx.query("effect")),
  ).rejects.toMatchObject({ code: "migration_frozen" });
  expect(f.effects()).toBe(0);
});

it("keeps admission throughout async work after freeze and drains only after final write", async () => {
  const f = fixture(),
    gate = createMigrationGate(f.db),
    db = gate.guardDatabase(f.db);
  const started = deferred(),
    finish = deferred();
  const op = gate.run(async () => {
    started.resolve();
    await finish.promise;
    await db.query("effect");
  });
  await started.promise;
  f.freeze();
  expect(f.admissions.size).toBe(1);
  await expect(gate.run(async () => db.query("effect"))).rejects.toMatchObject({
    code: "migration_frozen",
  });
  finish.resolve();
  await op;
  expect(f.effects()).toBe(1);
  expect(f.admissions.size).toBe(0);
});

it("reuses one pinned session for nested runs, queries and transactions", async () => {
  const f = fixture(),
    gate = createMigrationGate(f.db),
    db = gate.guardDatabase(f.db);
  await gate.run(() =>
    gate.run(async () => {
      await db.query("effect");
      await db.transaction((tx) => tx.query("effect"));
      await db.exec("effect");
    }),
  );
  expect(f.connections()).toBe(1);
  expect(f.effects()).toBe(3);
  expect(f.admissions.size).toBe(0);
});

it("does not release admission on rejection while a started child effect is still pending", async () => {
  const f = fixture(),
    gate = createMigrationGate(f.db),
    finish = deferred(),
    started = deferred();
  const op = gate.run(async () => {
    void gate.run(async () => {
      started.resolve();
      await finish.promise;
    });
    throw Error("aborted_request");
  });
  const result = op.catch((error: unknown) => error);
  await started.promise;
  await Promise.resolve();
  expect(f.admissions.size).toBe(1);
  finish.resolve();
  expect(await result).toMatchObject({ message: "aborted_request" });
  expect(f.admissions.size).toBe(0);
});

it("poisons a lost admission and preserves its marker even if a new pool connection works", async () => {
  const f = fixture(),
    gate = createMigrationGate(f.db),
    db = gate.guardDatabase(f.db);
  await expect(
    gate.run(async () => {
      f.losses[0].abort();
      await expect(db.query("effect")).rejects.toMatchObject({
        code: "migration_connection_lost",
      });
      await expect(
        gate.run(async () => {
          await f.db.query("effect");
        }),
      ).rejects.toMatchObject({ code: "migration_connection_lost" });
    }),
  ).rejects.toMatchObject({ code: "migration_connection_lost" });
  expect(f.effects()).toBe(0);
  expect(f.admissions.size).toBe(1);
  f.freeze();
  await expect(gate.assertOpen()).rejects.toMatchObject({
    code: "migration_frozen",
  });
  expect(f.admissions.size).toBe(1);
});

it("rejects stale async context after its parent admission has completed", async () => {
  const f = fixture(),
    gate = createMigrationGate(f.db),
    go = deferred();
  let late!: Promise<unknown>;
  await gate.run(async () => {
    late = go.promise.then(() =>
      gate.run(async () => {
        await f.db.query("effect");
      }),
    );
  });
  go.resolve();
  await expect(late).rejects.toMatchObject({
    code: "migration_admission_closed",
  });
  expect(f.effects()).toBe(0);
});
