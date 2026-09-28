import type { Database } from "../database.js";
import type { PrivateStorage } from "./storage.js";
import type { JobQueue } from "./queue.js";
import type { MultimodalProvider } from "../../../grading-gateway/src/providers/multimodalProviderTypes.js";
import type { GatewayRuntimeConfig } from "../../../grading-gateway/src/gatewayRuntimeConfig.js";
import type { GatewayTaskMaterial } from "../../../grading-gateway/src/multipartTaskMaterials.js";
import {
  executeMultimodalOperation,
  type MultimodalOperation,
} from "../../../grading-gateway/src/multimodal/executeOperation.js";
import { createCanonicalGradeIdentity } from "../../../grading-gateway/src/multimodal/logicalRequestIdentity.js";
import { GRADING_POLICY_VERSION } from "../../../grading-gateway/src/multimodal/gradingPolicy.js";
import { ESSAY_PROVIDER_SCHEMA_VERSION } from "../../../grading-gateway/src/multimodal/modelTaskContext.js";
import { GradingProviderError } from "../../../grading-gateway/src/providers/providerTypes.js";
import { PilotUploadService } from "./uploads.js";
import { PersistentAdmission } from "./admission.js";
import { recoverPilotWork } from "./recovery.js";
import { PilotError } from "./errors.js";
import { id } from "./validation.js";
export interface WorkerDeps {
  db: Database;
  uploads: PilotUploadService;
  storage: PrivateStorage;
  queue: JobQueue;
  provider?: MultimodalProvider;
  providerFactory?: () => {
    provider: MultimodalProvider;
    runtimeConfig?: GatewayRuntimeConfig;
  };
  runtimeConfig?: GatewayRuntimeConfig;
  now?: () => number;
}
export async function runPilotJob(
  jobId: string,
  deps: WorkerDeps,
): Promise<"done" | "deferred"> {
  const clock = deps.now ?? Date.now,
    started = clock();
  id(jobId);
  const maintenance = (
    await deps.db.query<{
      owner_id: string | null;
      cursor: string | null;
      state: string;
    }>(
      "SELECT owner_id,cursor,state FROM pilot_grading.maintenance_jobs WHERE id=$1",
      [jobId],
    )
  ).rows[0];
  if (maintenance) {
    if (maintenance.state === "done") return "done";
    await recoverPilotWork(
      {
        ...deps,
        ownerId: maintenance.owner_id ?? undefined,
        cursor: maintenance.cursor ?? undefined,
        continuationId: jobId,
      },
      50,
    );
    await deps.db.query(
      "UPDATE pilot_grading.maintenance_jobs SET state='done' WHERE id=$1",
      [jobId],
    );
    return "done";
  }
  const gate = new PersistentAdmission(deps.db),
    claim = await gate.claim(jobId);
  if (claim.kind === "terminal") return "done";
  if (claim.kind === "paused") return "deferred";
  if (claim.kind === "busy") {
    const j = (
      await deps.db.query<{ state: string }>(
        "SELECT state FROM pilot_grading.jobs WHERE id=$1",
        [jobId],
      )
    ).rows[0];
    return j?.state === "result_unknown" ? "done" : "deferred";
  }
  if (claim.kind !== "claimed") return "deferred";
  const { job, lease } = claim,
    controller = new AbortController();
  let began = false;
  try {
    let selected:
      | { provider: MultimodalProvider; runtimeConfig?: GatewayRuntimeConfig }
      | undefined;
    try {
      selected = deps.provider
        ? { provider: deps.provider, runtimeConfig: deps.runtimeConfig }
        : deps.providerFactory?.();
    } catch {
      throw new GradingProviderError(
        "provider_not_configured",
        "Provider configuration unavailable",
        true,
        undefined,
        { termination: "confirmed", pauseAdmission: true },
      );
    }
    if (!selected)
      throw new GradingProviderError(
        "provider_not_configured",
        "Provider configuration unavailable",
        true,
        undefined,
        { termination: "confirmed", pauseAdmission: true },
      );
    const s = job.input_snapshot;
    const images = await Promise.all(
      s.uploadIds.map((upload) =>
        deps.uploads.loadVerified(
          job.owner_id,
          upload,
          AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        ),
      ),
    );
    let operation: MultimodalOperation;
    if (job.kind === "grade") {
      if (!s.task || !s.essayId) throw new PilotError("invalid_snapshot", 500);
      const input = {
        requestId: job.id,
        task: s.task,
        essayId: s.essayId,
        pages: images,
        confirmedTranscript: s.confirmedTranscript,
        signal: controller.signal,
      };
      const canonical = createCanonicalGradeIdentity(
        { ...input, pageIds: images.map((p) => p.pageId) },
        {
          gradingPolicyVersion: GRADING_POLICY_VERSION,
          providerSchemaVersion: ESSAY_PROVIDER_SCHEMA_VERSION,
        },
      );
      await deps.db.query(
        "UPDATE pilot_grading.executions SET canonical_identity=$4 WHERE id=$1 AND token=$2 AND fence=$3 AND state='preparing'",
        [
          lease.executionId,
          lease.token,
          lease.fence,
          JSON.stringify(canonical),
        ],
      );
      operation = { kind: "grade", input };
    } else {
      if (!s.draft?.fullScore) throw new PilotError("invalid_snapshot", 500);
      const d = s.draft;
      const materials: GatewayTaskMaterial[] = d.materialRefs.map((r) =>
        r.kind === "text"
          ? {
              kind: "text",
              unitId: r.id,
              displayName: r.displayName,
              text: r.text,
            }
          : {
              kind: "image",
              unitId: r.uploadId,
              mimeType: images.find((i) => i.pageId === r.uploadId)!.mimeType,
              buffer: images.find((i) => i.pageId === r.uploadId)!.buffer,
            },
      );
      const input = {
        requestId: job.id,
        fullScore: d.fullScore!,
        writingRequirement: d.writingRequirement,
        materials,
        signal: controller.signal,
      };
      operation =
        job.kind === "rubric"
          ? { kind: "rubric", input }
          : { kind: "material_context", input };
    }
    const remaining = 290000 - (clock() - started);
    if (remaining < 1000) throw new PilotError("preparation_timeout", 503);
    if (!(await gate.beginCall(lease, Math.min(290000, Math.floor(remaining)))))
      return "done";
    began = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, remaining);
    });
    const execution = executeMultimodalOperation(selected.provider, operation, {
      runtimeConfig: selected.runtimeConfig,
    }).then(
      async (result) => {
        await gate.complete(lease, result);
        return "settled" as const;
      },
      async (error) => {
        await gate.fail(lease, error, { aborted: controller.signal.aborted });
        return "settled" as const;
      },
    );
    // Keep a handler attached so an original, late result can finish with its own lease.
    void execution.catch(() => {});
    try {
      if ((await Promise.race([execution, deadline])) === "timeout")
        await gate.fail(
          lease,
          new GradingProviderError(
            "provider_timeout",
            "Operation deadline reached",
            false,
            undefined,
            { termination: "unknown" },
          ),
          { aborted: true },
        );
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    await gate.fail(lease, error, { aborted: controller.signal.aborted });
    if (began && !(error instanceof GradingProviderError))
      throw new PilotError("worker_persistence_failed", 503);
  }
  // This is queue recovery only. Failure causes redelivery of the same durable job.
  await recoverPilotWork({ ...deps, ownerId: job.owner_id }, 50);
  return "done";
}
