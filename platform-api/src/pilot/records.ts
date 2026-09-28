import type { Queryable } from "../database.js";
import type {
  JobDto,
  EssayDto,
  PageDto,
  ResultDto,
} from "../../../shared/pilotContracts.js";
import { id } from "./validation.js";
import { notFound } from "./errors.js";
export type JobRow = Record<string, unknown> & {
  id: string;
  owner_id: string;
  task_id: string;
  essay_id: string | null;
  kind: JobDto["kind"];
  state: JobDto["state"];
  revision: number;
  source_revision: number | null;
  rubric_revision: number | null;
  essay_revision: number | null;
  draft_revision: number | null;
  retryable: boolean;
  error_code: string | null;
  retry_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  result: JobDto["result"] | null;
  attempts: number;
  rate_limit_requeues: number;
  input_snapshot: JobInput;
};
export type JobInput = {
  task?: import("../../../grading-gateway/src/multimodal/types.js").ConfirmedTaskPackageV2;
  draft?: import("../../../shared/pilotContracts.js").TaskDraftInput;
  uploadIds: string[];
  confirmedTranscript?: string;
  essayId?: string;
};
export type EssayRow = Record<string, unknown> & {
  owner_id: string;
  task_id: string;
  id: string;
  revision: number;
  source_revision: number;
  student_name: string;
  essay_number: number;
  confirmed_transcript: string | null;
  current_result_job_id: string | null;
  teacher_reviewed: boolean;
  manual_review_required: boolean;
};
export function projectJob(r: JobRow): JobDto {
  return {
    id: r.id,
    kind: r.kind,
    state: r.state,
    errorCode: r.error_code,
    retryable: r.retryable,
    revision: r.revision,
    retryAt: r.retry_at ? new Date(r.retry_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    ...(r.kind !== "grade" && r.result ? { result: r.result } : {}),
  };
}
export async function ownedJob(
  tx: Queryable,
  owner: string,
  job: string,
  lock = false,
): Promise<JobRow> {
  const r = (
    await tx.query<JobRow>(
      `SELECT j.* FROM pilot_grading.jobs j JOIN pilot_grading.tasks t ON t.owner_id=j.owner_id AND t.id=j.task_id WHERE j.owner_id=$1 AND j.id=$2 AND t.deleted_at IS NULL${lock ? " FOR UPDATE OF j" : ""}`,
      [id(owner), id(job)],
    )
  ).rows[0];
  return r ?? notFound();
}
export async function ownedEssay(
  tx: Queryable,
  owner: string,
  essay: string,
  lock = false,
): Promise<EssayRow> {
  const r = (
    await tx.query<EssayRow>(
      `SELECT e.* FROM pilot_grading.essays e JOIN pilot_grading.tasks t ON t.owner_id=e.owner_id AND t.id=e.task_id WHERE e.owner_id=$1 AND e.id=$2 AND t.deleted_at IS NULL${lock ? " FOR UPDATE OF e" : ""}`,
      [id(owner), id(essay)],
    )
  ).rows[0];
  return r ?? notFound();
}
export async function projectEssay(
  tx: Queryable,
  r: EssayRow,
): Promise<EssayDto> {
  const pages = (
    await tx.query<{
      upload_id: string;
      page_number: number;
      label: string;
      mime_type: PageDto["mimeType"];
      size: number;
    }>(
      "SELECT p.upload_id,p.page_number,u.label,u.mime_type,u.size FROM pilot_grading.essay_pages p JOIN pilot_grading.uploads u ON u.owner_id=p.owner_id AND u.id=p.upload_id WHERE p.owner_id=$1 AND p.essay_id=$2 ORDER BY p.page_number",
      [r.owner_id, r.id],
    )
  ).rows.map((p) => ({
    id: p.upload_id,
    uploadId: p.upload_id,
    pageNumber: p.page_number,
    label: p.label,
    mimeType: p.mime_type,
    size: p.size,
  }));
  const job = (
    await tx.query<JobRow>(
      "SELECT * FROM pilot_grading.jobs WHERE owner_id=$1 AND essay_id=$2 AND (source_revision=$3 OR state IN ('queued','running','result_unknown')) ORDER BY created_at DESC,id DESC LIMIT 1",
      [r.owner_id, r.id, r.source_revision],
    )
  ).rows[0];
  let result: ResultDto | null = null;
  if (r.current_result_job_id) {
    const a = (
      await tx.query<
        Record<string, unknown> & {
          ai: ResultDto["ai"];
          source_revision: number;
          rubric_revision: number;
          review: ResultDto["review"];
          revision: number | null;
          updated_at: Date | string;
        }
      >(
        `SELECT g.ai,g.source_revision,g.rubric_revision,v.review,v.revision,coalesce(v.updated_at,g.created_at) AS updated_at FROM pilot_grading.grading_results g LEFT JOIN pilot_grading.teacher_reviews v ON v.owner_id=g.owner_id AND v.job_id=g.job_id WHERE g.owner_id=$1 AND g.job_id=$2`,
        [r.owner_id, r.current_result_job_id],
      )
    ).rows[0];
    if (a)
      result = {
        resultRevision: 1 + (a.revision ?? 0),
        sourceRevision: a.source_revision,
        rubricRevision: a.rubric_revision,
        ai: a.ai,
        review: a.review ?? null,
        updatedAt: new Date(a.updated_at).toISOString(),
      };
  }
  return {
    id: r.id,
    taskId: r.task_id,
    revision: r.revision,
    sourceRevision: r.source_revision,
    studentName: r.student_name,
    essayNumber: r.essay_number,
    pages,
    confirmedTranscript: r.confirmed_transcript,
    currentJob: job ? projectJob(job) : null,
    currentResult: result,
    teacherReviewed: r.teacher_reviewed,
    manualReviewRequired: r.manual_review_required,
  };
}
