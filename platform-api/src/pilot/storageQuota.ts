import type { Queryable } from "../database.js";
import { MAX_RUBRIC_IMAGE_BYTES } from "../../../grading-gateway/src/multipartImages.js";
import { PilotError, invalid } from "./errors.js";
export class StorageQuota {
  constructor(private maximumBytes = 20 * 1024 ** 3) {
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 20 * 1024 ** 3
    )
      invalid();
  }
  /** Caller inserts the reservation before committing this same transaction. */
  async reserve(tx: Queryable, bytes: number): Promise<void> {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > MAX_RUBRIC_IMAGE_BYTES
    )
      invalid();
    // Namespace 1464486217: 1 admission, 2 migration administration, 3 quota.
    await tx.query("SELECT pg_advisory_xact_lock(1464486217, 3)");
    const row = (
      await tx.query<{ total: string }>(
        "SELECT coalesce(sum(size),0)::text AS total FROM pilot_grading.uploads WHERE purged_at IS NULL",
      )
    ).rows[0];
    if (!row || !/^\d+$/.test(row.total))
      throw new PilotError("storage_unavailable", 503);
    if (BigInt(row.total) + BigInt(bytes) > BigInt(this.maximumBytes))
      throw new PilotError("storage_quota_exceeded", 503);
  }
}
