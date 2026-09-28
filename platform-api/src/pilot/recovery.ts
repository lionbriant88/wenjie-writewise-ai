import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { PrivateStorage } from "./storage.js";
import type { JobQueue } from "./queue.js";
import { id, integer } from "./validation.js";
import { recoverExpiredExecutions } from "./admission.js";
import { PilotCleanupService } from "./cleanup.js";
export interface RecoveryDeps {
  db: Database;
  queue: JobQueue;
  storage: PrivateStorage;
  ownerId?: string;
  cursor?: string;
  continuationId?: string;
}
export async function recoverPilotWork(
  deps: RecoveryDeps,
  limit: number,
): Promise<{ published: number; cleaned: number }> {
  integer(limit, 1, 50);
  if (deps.ownerId) id(deps.ownerId);
  if (deps.cursor) id(deps.cursor);
  const { db, queue } = deps;
  await recoverExpiredExecutions(db);
  // Rotate expired deliveries in the database, never invent a new grading identity.
  await db.query(
    "UPDATE pilot_grading.outbox SET generation=generation+1,sent_at=NULL WHERE job_id IN (SELECT o.job_id FROM pilot_grading.outbox o JOIN pilot_grading.jobs j ON j.id=o.job_id WHERE j.state='queued' AND ($1::uuid IS NULL OR j.owner_id=$1) AND o.sent_at<now()-interval '24 hours' ORDER BY o.job_id LIMIT $2)",
    [deps.ownerId ?? null, limit],
  );
  const rows = (
    await db.query<{ job_id: string; generation: number; delay: number }>(
      `SELECT o.job_id,o.generation,greatest(0,ceil(extract(epoch FROM o.available_at-now())))::int AS delay FROM pilot_grading.outbox o JOIN pilot_grading.jobs j ON j.id=o.job_id JOIN pilot_grading.tasks t ON t.owner_id=j.owner_id AND t.id=j.task_id JOIN pilot_auth.accounts a ON a.id=j.owner_id WHERE j.state='queued' AND t.deleted_at IS NULL AND a.status='active' AND o.sent_at IS NULL AND ($1::uuid IS NULL OR j.owner_id=$1) AND ($2::uuid IS NULL OR o.job_id>$2) ORDER BY o.job_id LIMIT $3`,
      [deps.ownerId ?? null, deps.cursor ?? null, limit + 1],
    )
  ).rows;
  let published = 0;
  // Reserve one publication slot for recovery itself when processing a full page.
  const jobLimit = Math.max(1, limit - 1);
  for (const row of rows.slice(0, jobLimit)) {
    await queue.publish(
      row.job_id,
      row.job_id + ":" + row.generation,
      row.delay,
    );
    await db.query(
      "UPDATE pilot_grading.outbox SET sent_at=now() WHERE job_id=$1 AND generation=$2 AND sent_at IS NULL",
      [row.job_id, row.generation],
    );
    published++;
  }
  const cleaned = await new PilotCleanupService(db, deps.storage).runBatch(
    limit,
    deps.ownerId,
  );
  const pendingContent =
    (
      await db.query(
        "SELECT id FROM pilot_grading.tasks t WHERE deleted_at IS NOT NULL AND content_purged_at IS NULL AND ($1::uuid IS NULL OR owner_id=$1) AND NOT EXISTS(SELECT 1 FROM pilot_grading.jobs j JOIN pilot_grading.executions x ON x.job_id=j.id WHERE j.owner_id=t.owner_id AND j.task_id=t.id AND x.state='preparing') LIMIT 1",
        [deps.ownerId ?? null],
      )
    ).rows.length > 0;
  const expiredDeliveries =
    (
      await db.query(
        "SELECT o.job_id FROM pilot_grading.outbox o JOIN pilot_grading.jobs j ON j.id=o.job_id WHERE j.state='queued' AND ($1::uuid IS NULL OR j.owner_id=$1) AND o.sent_at<now()-interval '24 hours' LIMIT 1",
        [deps.ownerId ?? null],
      )
    ).rows.length > 0;
  if (
    rows.length > jobLimit ||
    cleaned === limit ||
    pendingContent ||
    expiredDeliveries
  ) {
    const continuation = randomUUID();
    await db.query(
      "INSERT INTO pilot_grading.maintenance_jobs(id,owner_id,cursor) VALUES($1,$2,$3)",
      [
        continuation,
        deps.ownerId ?? null,
        rows.length > jobLimit ? rows[jobLimit - 1].job_id : null,
      ],
    );
  }
  // Unsent continuation survives a failed publish, and public job reads never expose this table.
  await db.query(
    "UPDATE pilot_grading.maintenance_jobs SET generation=generation+1,sent_at=NULL WHERE id IN (SELECT id FROM pilot_grading.maintenance_jobs WHERE state='queued' AND ($1::uuid IS NULL OR owner_id=$1) AND sent_at<now()-interval '24 hours' ORDER BY id LIMIT $2)",
    [deps.ownerId ?? null, limit],
  );
  const continuations = (
    await db.query<{ id: string; generation: number }>(
      "SELECT id,generation FROM pilot_grading.maintenance_jobs WHERE state='queued' AND ($1::uuid IS NULL OR owner_id=$1) AND sent_at IS NULL AND ($2::uuid IS NULL OR id<>$2) ORDER BY id LIMIT $3",
      [deps.ownerId ?? null, deps.continuationId ?? null, limit - published],
    )
  ).rows;
  for (const c of continuations) {
    await queue.publish(c.id, c.id + ":" + c.generation);
    await db.query(
      "UPDATE pilot_grading.maintenance_jobs SET sent_at=now() WHERE id=$1 AND generation=$2",
      [c.id, c.generation],
    );
    published++;
  }
  return { published, cleaned };
}
