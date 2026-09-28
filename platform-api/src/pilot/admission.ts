import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.js";
import type { OperationResult } from "../../../grading-gateway/src/multimodal/executeOperation.js";
import {
  GradingProviderError,
  type ProviderAttemptObservation,
} from "../../../grading-gateway/src/providers/providerTypes.js";
import {
  createProviderTelemetryRecorder,
  type SafeProviderMetric,
} from "../../../grading-gateway/src/providerTelemetry.js";
import { createPilotProvider } from "../grading.js";
import { PilotError } from "./errors.js";
import { id, integer } from "./validation.js";
import type { JobRow } from "./records.js";
import { scheduleOutbox } from "./jobs.js";
export interface ExecutionLease {
  executionId: string;
  token: string;
  fence: number;
}
export type ClaimOutcome =
  | { kind: "terminal" | "busy" | "paused" }
  | { kind: "claimed"; job: JobRow; lease: ExecutionLease };
type Gate = Record<string, unknown> & {
  fence: number;
  active_execution_id: string | null;
  pause_reason: string | null;
  pause_revision: number;
};
type Execution = Record<string, unknown> & {
  id: string;
  job_id: string;
  token: string;
  fence: number;
  state: "preparing" | "calling" | "result_unknown" | "finished" | "revoked";
  prepare_expired: boolean;
  call_expired: boolean;
};
async function lockGate(tx: Queryable): Promise<Gate> {
  return (
    await tx.query<Gate>(
      "SELECT * FROM pilot_grading.provider_gate WHERE singleton=true FOR UPDATE",
    )
  ).rows[0];
}
async function execution(
  tx: Queryable,
  executionId: string,
): Promise<Execution | undefined> {
  return (
    await tx.query<Execution>(
      "SELECT *,prepare_deadline<now() AS prepare_expired,call_deadline<now() AS call_expired FROM pilot_grading.executions WHERE id=$1 FOR UPDATE",
      [executionId],
    )
  ).rows[0];
}
async function internalJob(
  tx: Queryable,
  job: string,
): Promise<JobRow | undefined> {
  return (
    await tx.query<JobRow>(
      "SELECT * FROM pilot_grading.jobs WHERE id=$1 FOR UPDATE",
      [job],
    )
  ).rows[0];
}
async function eligible(tx: Queryable, j: JobRow): Promise<boolean> {
  return !!(
    await tx.query(
      "SELECT t.id FROM pilot_grading.tasks t JOIN pilot_auth.accounts a ON a.id=t.owner_id WHERE t.owner_id=$1 AND t.id=$2 AND t.deleted_at IS NULL AND a.status='active' AND a.role='teacher'",
      [j.owner_id, j.task_id],
    )
  ).rows[0];
}
async function release(
  tx: Queryable,
  e: Execution,
  state: "finished" | "revoked",
) {
  await tx.query(
    "UPDATE pilot_grading.executions SET state=$2,finished_at=now() WHERE id=$1",
    [e.id, state],
  );
  await tx.query(
    "UPDATE pilot_grading.provider_gate SET active_execution_id=NULL WHERE singleton=true AND active_execution_id=$1",
    [e.id],
  );
}
async function cancel(tx: Queryable, j: JobRow) {
  await tx.query(
    "UPDATE pilot_grading.jobs SET state='cancelled',revision=revision+1,retryable=false,error_code=NULL,updated_at=now() WHERE id=$1",
    [j.id],
  );
}
async function recoverLocked(tx: Queryable, g: Gate): Promise<void> {
  if (!g.active_execution_id) return;
  const e = await execution(tx, g.active_execution_id);
  if (!e) return;
  if (e.state === "preparing" && e.prepare_expired) {
    const j = await internalJob(tx, e.job_id);
    await release(tx, e, "revoked");
    g.active_execution_id = null;
    if (j) {
      if (await eligible(tx, j)) {
        await tx.query(
          "UPDATE pilot_grading.jobs SET state='queued',revision=revision+1,updated_at=now() WHERE id=$1",
          [j.id],
        );
        await scheduleOutbox(tx, j.id);
      } else await cancel(tx, j);
    }
  } else if (e.state === "calling" && e.call_expired) {
    await tx.query(
      "UPDATE pilot_grading.executions SET state='result_unknown' WHERE id=$1",
      [e.id],
    );
    await tx.query(
      "UPDATE pilot_grading.jobs SET state='result_unknown',error_code='provider_result_unknown',retryable=false,revision=revision+1,updated_at=now() WHERE id=$1",
      [e.job_id],
    );
  }
}
export async function recoverExpiredExecutions(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await recoverLocked(tx, await lockGate(tx));
  });
}
function safeAttempts(
  job: JobRow,
  outcome: "success" | "failed",
  attempts: readonly ProviderAttemptObservation[] = [],
): SafeProviderMetric[] {
  const metrics: SafeProviderMetric[] = [];
  const recorder = createProviderTelemetryRecorder({
    emit: (m) => metrics.push(m),
  });
  recorder.recordUniqueAttempts(
    {
      stage:
        job.kind === "rubric"
          ? "rubric_generation"
          : job.kind === "material_context"
            ? "material_context"
            : job.input_snapshot.confirmedTranscript === undefined
              ? "essay_grading_images"
              : "essay_regrading_text",
      model: "deepseek-flash",
      reasoningEffort: "none",
      outcome,
    },
    attempts.slice(0, 5),
  );
  return metrics;
}
async function matching(
  tx: Queryable,
  g: Gate,
  lease: ExecutionLease,
): Promise<Execution | undefined> {
  if (g.active_execution_id !== lease.executionId) return;
  const e = await execution(tx, lease.executionId);
  return e && e.token === lease.token && e.fence === lease.fence
    ? e
    : undefined;
}
export class PersistentAdmission {
  constructor(private readonly db: Database) {}
  recoverExpired(): Promise<void> {
    return recoverExpiredExecutions(this.db);
  }
  async claim(jobId: string): Promise<ClaimOutcome> {
    id(jobId);
    return this.db.transaction(async (tx) => {
      const g = await lockGate(tx);
      await recoverLocked(tx, g);
      const j = await internalJob(tx, jobId);
      if (
        !j ||
        ["succeeded", "partial", "failed", "cancelled"].includes(j.state)
      )
        return { kind: "terminal" };
      if (g.active_execution_id) return { kind: "busy" };
      if (g.pause_reason) return { kind: "paused" };
      if (j.state !== "queued") return { kind: "busy" };
      if (!(await eligible(tx, j))) {
        await cancel(tx, j);
        return { kind: "terminal" };
      }
      if (j.retry_at && new Date(j.retry_at).getTime() > Date.now())
        return { kind: "busy" };
      const lease = {
        executionId: randomUUID(),
        token: randomUUID(),
        fence: g.fence + 1,
      };
      await tx.query(
        "INSERT INTO pilot_grading.executions(id,job_id,token,fence,state,prepare_deadline) VALUES($1,$2,$3,$4,'preparing',now()+interval '120 seconds')",
        [lease.executionId, jobId, lease.token, lease.fence],
      );
      await tx.query(
        "UPDATE pilot_grading.provider_gate SET fence=$1,active_execution_id=$2 WHERE singleton=true",
        [lease.fence, lease.executionId],
      );
      await tx.query(
        "UPDATE pilot_grading.jobs SET state='running',revision=revision+1,error_code=NULL,retryable=false,updated_at=now() WHERE id=$1",
        [jobId],
      );
      return { kind: "claimed", job: j, lease };
    });
  }
  async beginCall(
    lease: ExecutionLease,
    remainingMs = 290000,
  ): Promise<boolean> {
    integer(remainingMs, 1, 290000);
    return this.db.transaction(async (tx) => {
      const g = await lockGate(tx);
      await recoverLocked(tx, g);
      const e = await matching(tx, g, lease);
      if (!e || e.state !== "preparing") return false;
      const j = await internalJob(tx, e.job_id);
      if (!j) return false;
      if (!(await eligible(tx, j))) {
        await cancel(tx, j);
        await release(tx, e, "revoked");
        return false;
      }
      await tx.query(
        "UPDATE pilot_grading.executions SET state='calling',call_started_at=now(),call_deadline=now()+$2*interval '1 millisecond' WHERE id=$1",
        [e.id, remainingMs],
      );
      await tx.query(
        "UPDATE pilot_grading.jobs SET attempts=attempts+1 WHERE id=$1",
        [j.id],
      );
      return true;
    });
  }
  async complete(
    lease: ExecutionLease,
    result: OperationResult,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const g = await lockGate(tx),
        e = await matching(tx, g, lease);
      if (!e || !["calling", "result_unknown"].includes(e.state)) return;
      const j = await internalJob(tx, e.job_id);
      if (!j) return;
      if (j.kind !== result.kind)
        throw new PilotError("result_kind_mismatch", 500);
      const t = (
        await tx.query<{ deleted_at: Date | null; rubric_revision: number }>(
          "SELECT deleted_at,rubric_revision FROM pilot_grading.tasks WHERE owner_id=$1 AND id=$2",
          [j.owner_id, j.task_id],
        )
      ).rows[0];
      if (!t || t.deleted_at) {
        await cancel(tx, j);
        await release(tx, e, "finished");
        return;
      }
      if (result.kind === "grade") {
        if (
          result.value.resultVersion !== "grading-result-v2" ||
          result.value.essayId !== j.essay_id
        )
          throw new PilotError("result_identity_mismatch", 500);
        await tx.query(
          "INSERT INTO pilot_grading.grading_results(owner_id,task_id,essay_id,job_id,source_revision,rubric_revision,ai) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
          [
            j.owner_id,
            j.task_id,
            j.essay_id,
            j.id,
            j.source_revision,
            j.rubric_revision,
            JSON.stringify(result.value),
          ],
        );
        // The essay revision fences teacher edits as well as source changes.
        await tx.query(
          "UPDATE pilot_grading.essays SET current_result_job_id=$3,teacher_reviewed=false,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2 AND source_revision=$4 AND revision=$5 AND $6=$7",
          [
            j.owner_id,
            j.essay_id,
            j.id,
            j.source_revision,
            j.essay_revision,
            j.rubric_revision,
            t.rubric_revision,
          ],
        );
      }
      const state =
        result.kind === "grade" && result.value.status === "partial"
          ? "partial"
          : "succeeded";
      await tx.query(
        "UPDATE pilot_grading.jobs SET state=$2,result=$3,revision=revision+1,error_code=NULL,retryable=false,retry_at=NULL,updated_at=now() WHERE id=$1",
        [
          j.id,
          state,
          result.kind === "grade" ? null : JSON.stringify(result.value),
        ],
      );
      await tx.query(
        "UPDATE pilot_grading.executions SET attempts=$2 WHERE id=$1",
        [e.id, JSON.stringify(safeAttempts(j, "success", result.attempts))],
      );
      await release(tx, e, "finished");
    });
  }
  async fail(
    lease: ExecutionLease,
    error: unknown,
    options: { aborted?: boolean } = {},
  ): Promise<void> {
    const aborted =
      options.aborted ||
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof GradingProviderError &&
        error.code === "provider_timeout");
    const direct =
      error instanceof Error &&
      error.cause &&
      typeof error.cause === "object" &&
      "code" in error.cause &&
      "syscall" in error.cause &&
      error.cause.code === "EACCES" &&
      error.cause.syscall === "connect";
    const confirmed =
      !aborted &&
      (direct ||
        (error instanceof GradingProviderError &&
          error.details?.termination === "confirmed"));
    await this.db.transaction(async (tx) => {
      const g = await lockGate(tx),
        e = await matching(tx, g, lease);
      if (!e || !["preparing", "calling", "result_unknown"].includes(e.state))
        return;
      const j = await internalJob(tx, e.job_id);
      if (!j) return;
      // Preparation errors are provably before beginCall, so no Provider request exists.
      if (e.state !== "preparing" && !confirmed) {
        await tx.query(
          "UPDATE pilot_grading.executions SET state='result_unknown' WHERE id=$1",
          [e.id],
        );
        await tx.query(
          "UPDATE pilot_grading.jobs SET state='result_unknown',error_code='provider_result_unknown',retryable=false,revision=revision+1,updated_at=now() WHERE id=$1",
          [j.id],
        );
        return;
      }
      const code =
        error instanceof GradingProviderError
          ? error.code
          : error instanceof PilotError
            ? error.code
            : direct
              ? "provider_unavailable"
              : "preparation_failed";
      const pause = [
        "provider_auth_failed",
        "provider_balance_unavailable",
        "provider_not_configured",
      ].includes(code);
      const rateLimited = code === "provider_rate_limited";
      const requeue = rateLimited && j.rate_limit_requeues < 5;
      const retryAfter =
        error instanceof GradingProviderError
          ? error.details?.retryAfterMs
          : undefined;
      const delay = Math.max(
        2000 * Math.pow(2, j.rate_limit_requeues),
        Number.isFinite(retryAfter)
          ? Math.min(900000, Math.max(0, retryAfter!))
          : 0,
      );
      const retryable =
        !rateLimited &&
        j.attempts < 2 &&
        (direct || (error instanceof GradingProviderError && error.retryable));
      await tx.query(
        "UPDATE pilot_grading.jobs SET state=$2,error_code=$3,retryable=$4,retry_at=CASE WHEN $5 THEN now()+$6*interval '1 millisecond' ELSE NULL END,rate_limit_requeues=rate_limit_requeues+CASE WHEN $5 THEN 1 ELSE 0 END,attempts=attempts-CASE WHEN $7 AND attempts>0 THEN 1 ELSE 0 END,revision=revision+1,updated_at=now() WHERE id=$1",
        [
          j.id,
          requeue ? "queued" : "failed",
          code,
          !!retryable,
          requeue,
          delay,
          rateLimited,
        ],
      );
      if (pause)
        await tx.query(
          "UPDATE pilot_grading.provider_gate SET pause_reason=$1,pause_revision=pause_revision+1 WHERE singleton=true",
          [code],
        );
      if (error instanceof GradingProviderError)
        await tx.query(
          "UPDATE pilot_grading.executions SET attempts=$2 WHERE id=$1",
          [
            e.id,
            JSON.stringify(
              safeAttempts(j, "failed", error.details?.attemptObservations),
            ),
          ],
        );
      await release(tx, e, "finished");
      if (requeue) await scheduleOutbox(tx, j.id, delay);
    });
  }
}
export async function resumeKnownPause(
  db: Database,
  expectedPauseRevision: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  integer(expectedPauseRevision, 1);
  createPilotProvider(env);
  await db.transaction(async (tx) => {
    const g = await lockGate(tx);
    if (
      g.active_execution_id ||
      g.pause_revision !== expectedPauseRevision ||
      ![
        "provider_auth_failed",
        "provider_balance_unavailable",
        "provider_not_configured",
      ].includes(g.pause_reason ?? "")
    )
      throw new PilotError("resume_not_allowed", 409);
    await tx.query(
      "UPDATE pilot_grading.provider_gate SET pause_reason=NULL,pause_revision=pause_revision+1 WHERE singleton=true",
    );
  });
}
