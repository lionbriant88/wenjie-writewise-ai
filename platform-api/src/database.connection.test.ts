import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { createPostgresDatabase } from "./database.js";
import { createMigrationGate } from "./pilot/migrationGate.js";

const harness = vi.hoisted(() => ({
  clients: [] as EventEmitter[],
  sql: [] as string[],
  releases: [] as boolean[],
  active: 0,
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      on() {}
      async query() {
        throw Error("unbound_pool_query");
      }
      async end() {}
      async connect() {
        if (harness.active >= 3) throw Error("pool_exhausted");
        harness.active++;
        const client = new EventEmitter();
        harness.clients.push(client);
        return Object.assign(client, {
          async query(sql: string) {
            harness.sql.push(sql);
            if (sql === "sql_error")
              throw Object.assign(Error("private_sql_message"), {
                code: "23505",
              });
            if (sql === "wire_error")
              throw Object.assign(Error("private_wire_message"), {
                code: "ECONNRESET",
              });
            if (sql.includes("enter_migration"))
              return { rows: [{ admitted: true }] };
            if (sql.includes("leave_migration"))
              return { rows: [{ released: true }] };
            return { rows: [] };
          },
          release(discard: boolean) {
            harness.releases.push(discard);
            harness.active--;
          },
        });
      }
    },
  },
}));
beforeEach(() => {
  harness.clients = [];
  harness.sql = [];
  harness.releases = [];
  harness.active = 0;
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function database() {
  return createPostgresDatabase(
    "postgresql://synthetic:synthetic@localhost/synthetic",
  );
}

it("serializes unrelated session queries around a transaction without nested pool checkouts", async () => {
  const db = database(),
    started = deferred(),
    finish = deferred();
  await db.withConnection!(async (connection) => {
    const transaction = connection.transaction(async (tx) => {
      await tx.query("first");
      started.resolve();
      await finish.promise;
      await connection.query("nested_same_transaction");
    });
    await started.promise;
    const unrelated = connection.query("unrelated");
    finish.resolve();
    await Promise.all([transaction, unrelated]);
  });
  expect(harness.sql).toEqual([
    "BEGIN",
    "first",
    "nested_same_transaction",
    "COMMIT",
    "unrelated",
  ]);
  expect(harness.clients).toHaveLength(1);
  expect(harness.releases).toEqual([false]);
});

it("runs three admitted effects with nested SQL at pool max three", async () => {
  const db = database(),
    gate = createMigrationGate(db),
    guarded = gate.guardDatabase(db),
    finish = deferred();
  let started = 0;
  const allStarted = deferred();
  const operations = [1, 2, 3].map(() =>
    gate.run(async () => {
      if (++started === 3) allStarted.resolve();
      await finish.promise;
      await guarded.transaction(async (tx) => {
        await tx.query("nested_effect");
      });
      await gate.run(() => guarded.query("final_effect"));
    }),
  );
  await allStarted.promise;
  expect(harness.active).toBe(3);
  finish.resolve();
  await Promise.all(operations);
  expect(harness.clients).toHaveLength(3);
  expect(harness.releases).toEqual([false, false, false]);
});

it("retains a usable pinned session after rollback but destroys it after an escaping callback error", async () => {
  const db = database();
  await db.withConnection!(async (connection) => {
    await expect(
      connection.transaction((tx) => tx.query("sql_error")),
    ).rejects.toThrow("private_sql_message");
    expect(connection.signal.aborted).toBe(false);
    await connection.query("after_rollback");
  });
  expect(harness.sql).toEqual([
    "BEGIN",
    "sql_error",
    "ROLLBACK",
    "after_rollback",
  ]);
  await expect(
    db.withConnection!(async () => {
      throw Error("callback_failed");
    }),
  ).rejects.toThrow("callback_failed");
  expect(harness.releases).toEqual([false, true]);
});

it.each(["event", "wire"])(
  "fails closed after %s connection loss without issuing later effects",
  async (mode) => {
    const db = database();
    await db.withConnection!(async (connection) => {
      if (mode === "event")
        harness.clients[0].emit("error", Error("private_connection_error"));
      else
        await expect(connection.query("wire_error")).rejects.toThrow(
          "private_wire_message",
        );
      expect(connection.signal.aborted).toBe(true);
      await expect(connection.query("must_not_execute")).rejects.toThrow(
        "database_connection_lost",
      );
    });
    expect(harness.sql).not.toContain("must_not_execute");
    expect(harness.releases).toEqual([true]);
  },
);

it("rejects a retained query handle after the session has returned to its pool", async () => {
  const db = database();
  let late!: () => Promise<unknown>;
  await db.withConnection!(async (connection) => {
    late = () => connection.query("late_effect");
  });
  await expect(late()).rejects.toThrow("database_connection_lost");
  expect(harness.sql).toEqual([]);
});
