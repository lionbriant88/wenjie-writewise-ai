import type { Database } from "../database.js";
import type { Command } from "../../../shared/pilotContracts.js";
import type { PrivateStorage } from "./storage.js";
import { validateCommand, record, id, integer } from "./validation.js";
import { ownedTask, checkRevision } from "./tasks.js";
import { runCommand, payloadHash } from "./commands.js";
import { notFound } from "./errors.js";
const noPreparing = `NOT EXISTS(SELECT 1 FROM pilot_grading.jobs j JOIN pilot_grading.executions x ON x.job_id=j.id WHERE j.owner_id=t.owner_id AND j.task_id=t.id AND x.state='preparing')`;
export class PilotCleanupService {
  constructor(
    private readonly db: Database,
    private readonly storage: PrivateStorage,
  ) {}
  async deleteTask(
    owner: string,
    task: string,
    input: Command<Record<string, never>>,
  ): Promise<void> {
    const c = validateCommand(input, true);
    record(c.value, []);
    id(owner);
    id(task);
    await this.db.transaction(async (tx) => {
      const existing = (
        await tx.query(
          "SELECT id,deleted_at FROM pilot_grading.tasks WHERE owner_id=$1 AND id=$2",
          [owner, task],
        )
      ).rows[0];
      if (!existing) notFound();
      await runCommand(
        tx,
        owner,
        "task:delete:" + task,
        c,
        payloadHash(c),
        async () => {
          const t = await ownedTask(tx, owner, task, true);
          checkRevision(t.revision, c.expectedRevision);
          await tx.query(
            "UPDATE pilot_grading.tasks SET deleted_at=now(),revision=revision+1 WHERE owner_id=$1 AND id=$2",
            [owner, task],
          );
          await tx.query(
            "UPDATE pilot_grading.jobs SET state='cancelled',revision=revision+1,retryable=false WHERE owner_id=$1 AND task_id=$2 AND state='queued'",
            [owner, task],
          );
          await tx.query(
            "UPDATE pilot_grading.uploads SET deleted_at=coalesce(deleted_at,now()) WHERE owner_id=$1 AND task_id=$2",
            [owner, task],
          );
          return {};
        },
      );
    });
  }
  async runBatch(limit: number, owner?: string): Promise<number> {
    integer(limit, 1, 50);
    if (owner) id(owner);
    const tasks = (
      await this.db.query<{ owner_id: string; id: string }>(
        `SELECT t.owner_id,t.id FROM pilot_grading.tasks t WHERE t.deleted_at IS NOT NULL AND t.content_purged_at IS NULL AND ($1::uuid IS NULL OR owner_id=$1) AND ${noPreparing} ORDER BY t.id LIMIT $2`,
        [owner ?? null, limit],
      )
    ).rows;
    for (const t of tasks)
      await this.db.transaction(async (tx) => {
        // The owner lock serializes uploads/edits with purge. No gate lock is acquired here.
        await tx.query(
          "SELECT id FROM pilot_auth.accounts WHERE id=$1 FOR UPDATE",
          [t.owner_id],
        );
        const eligible = (
          await tx.query(
            `SELECT t.id FROM pilot_grading.tasks t WHERE t.owner_id=$1 AND t.id=$2 AND t.deleted_at IS NOT NULL AND t.content_purged_at IS NULL AND ${noPreparing} FOR UPDATE OF t`,
            [t.owner_id, t.id],
          )
        ).rows[0];
        if (!eligible) return;
        await tx.query(
          "SELECT id FROM pilot_grading.jobs WHERE owner_id=$1 AND task_id=$2 ORDER BY id FOR UPDATE",
          [t.owner_id, t.id],
        );
        await tx.query(
          `DELETE FROM pilot_grading.command_receipts WHERE owner_id=$1 AND operation<>'task:delete:'||$2 AND ((operation='task:create' AND response->>'id'=$2) OR right(operation,36) IN (SELECT $2 UNION SELECT id::text FROM pilot_grading.essays WHERE owner_id=$1 AND task_id=$2::uuid UNION SELECT id::text FROM pilot_grading.uploads WHERE owner_id=$1 AND task_id=$2::uuid UNION SELECT id::text FROM pilot_grading.jobs WHERE owner_id=$1 AND task_id=$2::uuid))`,
          [t.owner_id, t.id],
        );
        await tx.query(
          "UPDATE pilot_grading.essays SET student_name='',confirmed_transcript=NULL,current_result_job_id=NULL,teacher_reviewed=false WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "DELETE FROM pilot_grading.teacher_reviews WHERE owner_id=$1 AND job_id IN (SELECT id FROM pilot_grading.jobs WHERE owner_id=$1 AND task_id=$2)",
          [t.owner_id, t.id],
        );
        await tx.query(
          "DELETE FROM pilot_grading.grading_results WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "DELETE FROM pilot_grading.essay_pages WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "DELETE FROM pilot_grading.job_uploads WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "DELETE FROM pilot_grading.task_material_uploads WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "UPDATE pilot_grading.essay_sources SET confirmed_transcript=NULL WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "UPDATE pilot_grading.jobs SET input_snapshot='{}',result=NULL WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "UPDATE pilot_grading.task_revisions SET package='{}' WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "UPDATE pilot_grading.uploads SET label='' WHERE owner_id=$1 AND task_id=$2",
          [t.owner_id, t.id],
        );
        await tx.query(
          "UPDATE pilot_grading.tasks SET draft='{}',confirmed_package=NULL,content_purged_at=now() WHERE owner_id=$1 AND id=$2",
          [t.owner_id, t.id],
        );
      });
    // Claim deletion in SQL before touching Storage; stale signed upload tickets must expire first.
    const candidates = (
      await this.db.query<{ id: string; owner_id: string; path: string }>(
        `SELECT u.id,u.owner_id,u.path FROM pilot_grading.uploads u JOIN pilot_grading.tasks t ON t.owner_id=u.owner_id AND t.id=u.task_id
   WHERE u.purged_at IS NULL AND ($1::uuid IS NULL OR u.owner_id=$1) AND u.last_signed_at<now()-interval '2 hours' AND ${noPreparing}
   AND (t.deleted_at IS NOT NULL OR (u.created_at<now()-interval '24 hours' AND u.state<>'attached'
    AND NOT EXISTS(SELECT 1 FROM pilot_grading.task_material_uploads m WHERE m.upload_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM pilot_grading.essay_pages p WHERE p.upload_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM pilot_grading.job_uploads j WHERE j.upload_id=u.id))) ORDER BY u.id LIMIT $2`,
        [owner ?? null, limit],
      )
    ).rows;
    let cleaned = 0;
    for (const u of candidates) {
      const marked = await this.db.transaction(async (tx) => {
        await tx.query(
          "SELECT id FROM pilot_auth.accounts WHERE id=$1 FOR UPDATE",
          [u.owner_id],
        );
        return !!(
          await tx.query(
            `UPDATE pilot_grading.uploads u SET deleted_at=coalesce(u.deleted_at,now()) FROM pilot_grading.tasks t WHERE u.id=$1 AND u.owner_id=t.owner_id AND u.task_id=t.id AND u.purged_at IS NULL AND u.last_signed_at<now()-interval '2 hours' AND ${noPreparing} AND (t.deleted_at IS NOT NULL OR (u.state<>'attached' AND u.created_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM pilot_grading.job_uploads j WHERE j.upload_id=u.id) AND NOT EXISTS(SELECT 1 FROM pilot_grading.task_material_uploads m WHERE m.upload_id=u.id) AND NOT EXISTS(SELECT 1 FROM pilot_grading.essay_pages p WHERE p.upload_id=u.id))) RETURNING u.id`,
            [u.id],
          )
        ).rows[0];
      });
      if (!marked) continue;
      await this.storage.remove([u.path]);
      await this.db.query(
        "UPDATE pilot_grading.uploads SET purged_at=now() WHERE id=$1 AND owner_id=$2",
        [u.id, u.owner_id],
      );
      cleaned++;
    }
    return cleaned;
  }
}
