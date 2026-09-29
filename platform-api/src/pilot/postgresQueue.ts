import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import type { JobQueue } from "./queue.js";
import { PilotError } from "./errors.js";
import { id, integer } from "./validation.js";

export interface DeliveryLease {
  deliveryKey: string;
  jobId: string;
  token: string;
}

export interface PostgresJobQueue extends JobQueue {
  lease(): Promise<DeliveryLease | undefined>;
  acknowledge(lease: DeliveryLease): Promise<boolean>;
  defer(lease: DeliveryLease, delaySeconds: number): Promise<boolean>;
}

function deliveryIdentity(
  jobId: string,
  deliveryKey: string,
): { jobId: string; deliveryKey: string } {
  const canonicalJobId = id(jobId);
  if (typeof deliveryKey !== "string")
    throw new PilotError("invalid_delivery_key");
  const parts = /^([0-9a-fA-F-]{36}):([1-9][0-9]{0,9})$/.exec(deliveryKey);
  if (
    !parts ||
    id(parts[1]) !== canonicalJobId ||
    Number(parts[2]) > 2147483647
  )
    throw new PilotError("invalid_delivery_key");
  return {
    jobId: canonicalJobId,
    deliveryKey: `${canonicalJobId}:${parts[2]}`,
  };
}

function leaseIdentity(lease: DeliveryLease): DeliveryLease {
  if (!lease || typeof lease !== "object")
    throw new PilotError("invalid_delivery_lease");
  const { jobId, deliveryKey } = deliveryIdentity(
    lease.jobId,
    lease.deliveryKey,
  );
  return { jobId, deliveryKey, token: id(lease.token) };
}

export function createPostgresQueue(db: Database): PostgresJobQueue {
  return {
    async publish(jobId, deliveryKey, delaySeconds = 0) {
      const identity = deliveryIdentity(jobId, deliveryKey);
      integer(delaySeconds, 0, 86399);
      await db.query(
        `INSERT INTO pilot_grading.deliveries(delivery_key,job_id,available_at)
         VALUES($1,$2,now()+$3::int*interval '1 second')
         ON CONFLICT(delivery_key) DO NOTHING`,
        [identity.deliveryKey, identity.jobId, delaySeconds],
      );
    },
    async lease() {
      const token = randomUUID();
      const rows = await db.query<{
        delivery_key: string;
        job_id: string;
        lease_token: string;
      }>(
        `WITH candidate AS (
           SELECT delivery_key FROM pilot_grading.deliveries
           WHERE completed_at IS NULL AND available_at<=now()
             AND (lease_token IS NULL OR lease_expires_at<=now())
           ORDER BY available_at,delivery_key
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE pilot_grading.deliveries AS d
         SET lease_token=$1::uuid,lease_expires_at=now()+interval '600 seconds',attempts=attempts+1
         FROM candidate AS c WHERE d.delivery_key=c.delivery_key
         RETURNING d.delivery_key,d.job_id,d.lease_token`,
        [token],
      );
      const row = rows.rows[0];
      return row
        ? {
            deliveryKey: row.delivery_key,
            jobId: row.job_id,
            token: row.lease_token,
          }
        : undefined;
    },
    async acknowledge(lease) {
      const identity = leaseIdentity(lease);
      const rows = await db.query<{ delivery_key: string }>(
        `UPDATE pilot_grading.deliveries
         SET completed_at=now(),lease_token=NULL,lease_expires_at=NULL
         WHERE delivery_key=$1 AND job_id=$2::uuid AND lease_token=$3::uuid
           AND lease_expires_at>now() AND completed_at IS NULL
         RETURNING delivery_key`,
        [identity.deliveryKey, identity.jobId, identity.token],
      );
      return rows.rows.length === 1;
    },
    async defer(lease, delaySeconds) {
      const identity = leaseIdentity(lease);
      integer(delaySeconds, 0, 86399);
      const rows = await db.query<{ delivery_key: string }>(
        `UPDATE pilot_grading.deliveries
         SET available_at=now()+$4::int*interval '1 second',lease_token=NULL,lease_expires_at=NULL
         WHERE delivery_key=$1 AND job_id=$2::uuid AND lease_token=$3::uuid
           AND lease_expires_at>now() AND completed_at IS NULL
         RETURNING delivery_key`,
        [identity.deliveryKey, identity.jobId, identity.token, delaySeconds],
      );
      return rows.rows.length === 1;
    },
  };
}
