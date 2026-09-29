import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { createLocalDatabase } from "../localDatabase.js";
import type { Database } from "../database.js";
import { migrate } from "../migrate.js";
import { migratePilot } from "./migrate.js";
import { createPostgresQueue } from "./postgresQueue.js";

const firstJob = "00000000-0000-4000-8000-000000000001";
const secondJob = "00000000-0000-4000-8000-000000000002";
const migration = new URL(
  "../migrations/003_pilot_deliveries.sql",
  import.meta.url,
);

async function preparedDb(path?: string): Promise<Database> {
  const db = createLocalDatabase(path);
  await migrate(db);
  await migratePilot(db);
  await db.exec(await readFile(migration, "utf8"));
  return db;
}

it("installs a restricted, repeatable delivery table", async () => {
  const db = await preparedDb();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    await db.exec(
      "GRANT ALL ON pilot_grading.deliveries TO anon,authenticated;",
    );
    await db.exec(await readFile(migration, "utf8"));
    const grants = await db.query<{
      role: string;
      select_allowed: boolean;
      write_allowed: boolean;
    }>(
      `SELECT role, has_table_privilege(role,'pilot_grading.deliveries','SELECT') AS select_allowed,
         has_table_privilege(role,'pilot_grading.deliveries','INSERT') AS write_allowed
       FROM (VALUES ('anon'),('authenticated'),('wj_auth_runtime')) AS roles(role)`,
    );
    expect(grants.rows).toEqual([
      { role: "anon", select_allowed: false, write_allowed: false },
      { role: "authenticated", select_allowed: false, write_allowed: false },
      { role: "wj_auth_runtime", select_allowed: true, write_allowed: true },
    ]);
  } finally {
    await db.close();
  }
});

it("publishes one logical delivery, leases it, and completes it once", async () => {
  const db = await preparedDb();
  try {
    const queue = createPostgresQueue(db);
    await queue.publish(firstJob, `${firstJob}:1`);
    await queue.publish(firstJob, `${firstJob}:1`, 100);
    const lease = await queue.lease();
    expect(lease).toMatchObject({
      deliveryKey: `${firstJob}:1`,
      jobId: firstJob,
    });
    expect(lease?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await queue.lease()).toBeUndefined();
    expect(await queue.acknowledge(lease!)).toBe(true);
    expect(await queue.acknowledge(lease!)).toBe(false);
    await queue.publish(firstJob, `${firstJob}:1`);
    expect(await queue.lease()).toBeUndefined();
    const row = await db.query<{ attempts: number; completed: boolean }>(
      "SELECT attempts,completed_at IS NOT NULL AS completed FROM pilot_grading.deliveries",
    );
    expect(row.rows).toEqual([{ attempts: 1, completed: true }]);
  } finally {
    await db.close();
  }
});

it("honors delayed publication and token-fenced defer", async () => {
  const db = await preparedDb();
  try {
    const queue = createPostgresQueue(db);
    await queue.publish(firstJob, `${firstJob}:1`, 30);
    expect(await queue.lease()).toBeUndefined();
    await db.query(
      "UPDATE pilot_grading.deliveries SET available_at=now()-interval '1 second'",
    );
    const first = (await queue.lease())!;
    expect(await queue.defer(first, 30)).toBe(true);
    expect(await queue.defer(first, 0)).toBe(false);
    expect(await queue.lease()).toBeUndefined();
    await db.query(
      "UPDATE pilot_grading.deliveries SET available_at=now()-interval '1 second'",
    );
    const second = (await queue.lease())!;
    expect(second.token).not.toBe(first.token);
    expect(await queue.acknowledge(first)).toBe(false);
    expect(await queue.defer(first, 0)).toBe(false);
    expect(await queue.acknowledge(second)).toBe(true);
  } finally {
    await db.close();
  }
});

it("recovers an expired lease and fences its old token", async () => {
  const db = await preparedDb();
  try {
    const queue = createPostgresQueue(db);
    await queue.publish(firstJob, `${firstJob}:1`);
    const old = (await queue.lease())!;
    const expiry = await db.query<{ seconds: number }>(
      "SELECT round(extract(epoch FROM lease_expires_at-now()))::int AS seconds FROM pilot_grading.deliveries",
    );
    expect(expiry.rows[0].seconds).toBeGreaterThanOrEqual(598);
    expect(expiry.rows[0].seconds).toBeLessThanOrEqual(600);
    await db.query(
      "UPDATE pilot_grading.deliveries SET lease_expires_at=now()-interval '1 second'",
    );
    expect(await queue.acknowledge(old)).toBe(false);
    const newer = (await queue.lease())!;
    expect(newer.token).not.toBe(old.token);
    expect(await queue.defer(old, 0)).toBe(false);
    expect(await queue.acknowledge(newer)).toBe(true);
  } finally {
    await db.close();
  }
});

it("rejects malformed identities and delays before SQL", async () => {
  const db = await preparedDb();
  try {
    const queue = createPostgresQueue(db);
    for (const [jobId, key, delay] of [
      ["bad", "bad:1", 0],
      [firstJob, `${secondJob}:1`, 0],
      [firstJob, `${firstJob}:0`, 0],
      [firstJob, `${firstJob}:01`, 0],
      [firstJob, `${firstJob}:1`, -1],
      [firstJob, `${firstJob}:1`, 86400],
      [firstJob, `${firstJob}:1`, 1.1],
    ] as const)
      await expect(queue.publish(jobId, key, delay)).rejects.toThrow();
    await expect(
      queue.acknowledge({
        deliveryKey: `${firstJob}:1`,
        jobId: firstJob,
        token: "bad",
      }),
    ).rejects.toThrow();
    await expect(
      queue.defer(
        { deliveryKey: `${firstJob}:1`, jobId: firstJob, token: randomUUID() },
        86400,
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT delivery_key FROM pilot_grading.deliveries"))
        .rows,
    ).toEqual([]);
  } finally {
    await db.close();
  }
});

it("retains deliveries across database close and re-open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "writewise-deliveries-"));
  try {
    const db = await preparedDb(directory);
    await createPostgresQueue(db).publish(firstJob, `${firstJob}:3`);
    await db.close();
    const reopened = createLocalDatabase(directory);
    try {
      const lease = await createPostgresQueue(reopened).lease();
      expect(lease).toMatchObject({
        deliveryKey: `${firstJob}:3`,
        jobId: firstJob,
      });
    } finally {
      await reopened.close();
    }
  } finally {
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep))
      throw Error("unexpected test directory");
    await rm(absolute, { recursive: true, force: true });
  }
});
