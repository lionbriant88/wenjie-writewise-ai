import { expect, it } from "vitest";
import { createStandaloneWorker } from "./worker.js";
import type {
  DeliveryLease,
  PostgresJobQueue,
} from "../pilot/postgresQueue.js";
import type { PilotRuntime } from "../pilot/runtime.js";
import type { MigrationGate } from "../pilot/migrationGate.js";
const lease: DeliveryLease = {
  deliveryKey: "same:1",
  jobId: "same",
  token: "one",
};
function fixture(runJob: () => Promise<"done" | "deferred">) {
  let admissions = 0,
    claims = 0,
    ack = 0,
    delays: number[] = [];
  const gate: MigrationGate = {
    assertOpen: async () => {},
    guardDatabase: (db) => db,
    run: async (fn) => {
      admissions++;
      try {
        return await fn();
      } finally {
        admissions--;
      }
    },
  };
  const queue: PostgresJobQueue = {
    publish: async () => {},
    lease: async () => {
      claims++;
      return lease;
    },
    acknowledge: async (l) => {
      expect(l).toBe(lease);
      ack++;
      return true;
    },
    defer: async (l, d) => {
      expect(l).toBe(lease);
      delays.push(d);
      return true;
    },
  };
  const runtime = { postgresQueue: queue, migrationGate: gate } as PilotRuntime;
  const worker = createStandaloneWorker(runtime, async () => {
    expect(admissions).toBe(1);
    return runJob();
  });
  return { worker, counts: () => ({ admissions, claims, ack, delays }) };
}
it("serializes claims, stops new work and waits active job before shutdown", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    pending = new Promise<void>((r) => (release = r));
  const f = fixture(async () => {
    entered();
    await pending;
    return "done";
  });
  const first = f.worker.tick();
  await started;
  expect(await f.worker.tick()).toBe(false);
  expect(f.counts().claims).toBe(1);
  let stopped = false;
  const stop = f.worker.stop().then(() => (stopped = true));
  await Promise.resolve();
  expect(stopped).toBe(false);
  release();
  await first;
  await stop;
  expect(f.counts()).toEqual({ admissions: 0, claims: 1, ack: 1, delays: [] });
  expect(await f.worker.tick()).toBe(false);
});
it("defers the same lease on retryable failure or deferred job without new identity", async () => {
  for (const run of [
    async () => "deferred" as const,
    async () => {
      throw Error("failure");
    },
  ]) {
    const f = fixture(run);
    await f.worker.tick();
    expect(f.counts()).toEqual({
      admissions: 0,
      claims: 1,
      ack: 0,
      delays: [30],
    });
  }
});
it("acknowledges terminal duplicate jobs without inventing a new delivery", async () => {
  const f = fixture(async () => "done");
  await f.worker.tick();
  await f.worker.tick();
  expect(f.counts().ack).toBe(2);
});
