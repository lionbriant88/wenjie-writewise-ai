import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.js";
import type { Command, JobDto } from "../../../shared/pilotContracts.js";
import { record, validateCommand } from "./validation.js";
import { PilotError, invalid } from "./errors.js";
import { ownedTask, checkRevision } from "./tasks.js";
import { payloadHash, runCommand } from "./commands.js";
import {
  ownedJob,
  projectJob,
  type JobRow,
  type JobInput,
  type EssayRow,
} from "./records.js";
import { recoverExpiredExecutions } from "./admission.js";
export async function scheduleOutbox(
  tx: Queryable,
  job: string,
  delayMs = 0,
): Promise<void> {
  await tx.query(
    "INSERT INTO pilot_grading.outbox(job_id,available_at) VALUES($1,now()+$2*interval '1 millisecond') ON CONFLICT(job_id) DO UPDATE SET generation=pilot_grading.outbox.generation+1,available_at=excluded.available_at,sent_at=NULL",
    [job, delayMs],
  );
}
async function addJob(
  tx: Queryable,
  owner: string,
  task: string,
  kind: JobDto["kind"],
  identity: unknown,
  snapshot: JobInput,
  essay?: EssayRow,
  draftRevision?: number,
  rubricRevision?: number,
): Promise<JobRow> {
  const key = payloadHash(identity),
    existing = (
      await tx.query<JobRow>(
        "SELECT * FROM pilot_grading.jobs WHERE logical_key=$1",
        [key],
      )
    ).rows[0];
  if (existing) return existing;
  const job = randomUUID();
  await tx.query(
    "INSERT INTO pilot_grading.jobs(owner_id,task_id,id,essay_id,kind,source_revision,rubric_revision,essay_revision,draft_revision,logical_key,input_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      owner,
      task,
      job,
      essay?.id ?? null,
      kind,
      essay?.source_revision ?? null,
      rubricRevision ?? null,
      essay?.revision ?? null,
      draftRevision ?? null,
      key,
      JSON.stringify(snapshot),
    ],
  );
  for (const upload of snapshot.uploadIds)
    await tx.query(
      "INSERT INTO pilot_grading.job_uploads(owner_id,task_id,job_id,upload_id) VALUES($1,$2,$3,$4)",
      [owner, task, job, upload],
    );
  await scheduleOutbox(tx, job);
  return ownedJob(tx, owner, job);
}
export class PilotJobRepository {
  constructor(private readonly db: Database) {}
  async get(owner: string, job: string): Promise<JobDto> {
    await ownedJob(this.db, owner, job);
    await recoverExpiredExecutions(this.db);
    return projectJob(await ownedJob(this.db, owner, job));
  }
  async enqueueTask(
    owner: string,
    task: string,
    input: Command<Record<string, never>>,
  ): Promise<{ accepted: number }> {
    const c = validateCommand(input, false);
    record(c.value, []);
    return this.db.transaction(async (tx) => {
      await ownedTask(tx, owner, task);
      return runCommand(
        tx,
        owner,
        "job:task:" + task,
        c,
        payloadHash(c),
        async () => {
          const t = await ownedTask(tx, owner, task, true);
          if (t.state !== "confirmed" || !t.confirmed_package) return invalid();
          const essays = (
            await tx.query<EssayRow>(
              "SELECT * FROM pilot_grading.essays WHERE owner_id=$1 AND task_id=$2 ORDER BY essay_number FOR UPDATE",
              [owner, task],
            )
          ).rows;
          let accepted = 0;
          for (const e of essays) {
            if (
              e.teacher_reviewed ||
              e.manual_review_required ||
              e.current_result_job_id
            )
              continue;
            const active = (
              await tx.query(
                "SELECT id FROM pilot_grading.jobs WHERE owner_id=$1 AND essay_id=$2 AND state IN ('queued','running','result_unknown')",
                [owner, e.id],
              )
            ).rows[0];
            if (active) continue;
            const identity = {
              owner,
              task,
              essay: e.id,
              source: e.source_revision,
              rubric: t.rubric_revision,
              kind: "grade",
            };
            if (
              (
                await tx.query(
                  "SELECT id FROM pilot_grading.jobs WHERE logical_key=$1",
                  [payloadHash(identity)],
                )
              ).rows.length
            )
              continue;
            const uploadIds =
              e.confirmed_transcript === null
                ? (
                    await tx.query<{ upload_id: string }>(
                      "SELECT upload_id FROM pilot_grading.essay_pages WHERE owner_id=$1 AND essay_id=$2 ORDER BY page_number",
                      [owner, e.id],
                    )
                  ).rows.map((p) => p.upload_id)
                : [];
            await addJob(
              tx,
              owner,
              task,
              "grade",
              identity,
              {
                task: t.confirmed_package,
                essayId: e.id,
                uploadIds,
                ...(e.confirmed_transcript === null
                  ? {}
                  : { confirmedTranscript: e.confirmed_transcript }),
              },
              e,
              undefined,
              t.rubric_revision,
            );
            accepted++;
          }
          return { accepted };
        },
      );
    });
  }
  async enqueueMaterial(
    owner: string,
    task: string,
    input: Command<{ kind: "material_context" | "rubric" }>,
  ): Promise<JobDto> {
    const c = validateCommand(input, true),
      kind = record(c.value, ["kind"]).kind;
    if (kind !== "material_context" && kind !== "rubric") return invalid();
    return this.db.transaction(async (tx) => {
      await ownedTask(tx, owner, task);
      const jobId = await runCommand(
        tx,
        owner,
        "job:material:" + task,
        c,
        payloadHash(c),
        async () => {
          const t = await ownedTask(tx, owner, task, true);
          checkRevision(t.revision, c.expectedRevision);
          if (t.state !== "draft" || !t.draft.fullScore) return invalid();
          if (kind === "material_context" && !t.draft.materialRefs.length)
            return invalid();
          if (
            kind === "rubric" &&
            !t.draft.writingRequirement &&
            !t.draft.materialRefs.length &&
            !t.draft.materialContext
          )
            return invalid();
          return (
            await addJob(
              tx,
              owner,
              task,
              kind,
              { owner, task, kind, draftRevision: t.revision },
              {
                draft: t.draft,
                uploadIds: t.draft.materialRefs.flatMap((r) =>
                  r.kind === "image" ? [r.uploadId] : [],
                ),
              },
              undefined,
              t.revision,
            )
          ).id;
        },
      );
      return projectJob(await ownedJob(tx, owner, jobId));
    });
  }
  async retryKnown(
    owner: string,
    job: string,
    input: Command<Record<string, never>>,
  ): Promise<JobDto> {
    const c = validateCommand(input, true);
    record(c.value, []);
    return this.db.transaction(async (tx) => {
      await ownedJob(tx, owner, job);
      await runCommand(
        tx,
        owner,
        "job:retry:" + job,
        c,
        payloadHash(c),
        async () => {
          const j = await ownedJob(tx, owner, job, true);
          checkRevision(j.revision, c.expectedRevision);
          if (
            j.state !== "failed" ||
            !j.retryable ||
            j.attempts >= 2 ||
            j.rate_limit_requeues >= 5
          )
            throw new PilotError("retry_not_allowed", 409);
          if (j.essay_id) {
            const e = (
              await tx.query<EssayRow>(
                "SELECT * FROM pilot_grading.essays WHERE owner_id=$1 AND id=$2",
                [owner, j.essay_id],
              )
            ).rows[0];
            if (
              !e ||
              e.source_revision !== j.source_revision ||
              e.revision !== j.essay_revision ||
              e.manual_review_required
            )
              throw new PilotError("retry_not_allowed", 409);
            if (
              (
                await tx.query(
                  "SELECT id FROM pilot_grading.jobs WHERE owner_id=$1 AND essay_id=$2 AND state IN ('queued','running','result_unknown')",
                  [owner, j.essay_id],
                )
              ).rows.length
            )
              throw new PilotError("retry_not_allowed", 409);
          } else {
            const t = await ownedTask(tx, owner, j.task_id);
            if (t.revision !== j.draft_revision || t.state !== "draft")
              throw new PilotError("retry_not_allowed", 409);
          }
          await tx.query(
            "UPDATE pilot_grading.jobs SET state='queued',revision=revision+1,error_code=NULL,retryable=false,retry_at=NULL,updated_at=now() WHERE id=$1",
            [job],
          );
          await scheduleOutbox(tx, job);
          return { id: job };
        },
      );
      return projectJob(await ownedJob(tx, owner, job));
    });
  }
}
