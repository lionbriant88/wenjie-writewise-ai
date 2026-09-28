import { randomUUID } from "node:crypto";
import type {
  MultimodalProvider,
  GradeEssayProviderInput,
  GenerateMaterialContextProviderInput,
  GenerateRubricProviderInput,
  GatewayImageInput,
} from "../providers/multimodalProviderTypes.js";
import {
  GradingProviderError,
  type ProviderCallResult,
  type ProviderCallStage,
} from "../providers/providerTypes.js";
import type { GatewayRuntimeConfig } from "../gatewayRuntimeConfig.js";
import {
  createProviderTelemetryRecorder,
  recordUniqueProviderAttempts,
  recordProviderOperation,
  type ProviderTelemetryRecorder,
} from "../providerTelemetry.js";
import {
  emitSafeGradingDiagnostic,
  type SafeGradingDiagnosticSink,
} from "../safeDiagnostics.js";
import { readSafeImageDimensions } from "../imageMetadata.js";
import {
  normalizeMultimodalResult,
  type MultimodalGradingResult,
} from "./normalizeMultimodalResult.js";
import { validateGeneratedRubric } from "./validateRubric.js";
import { validateTaskMaterialContext } from "./materialContextContract.js";
import type { GeneratedRubricV1, TaskMaterialContextV1 } from "./types.js";

export type MultimodalOperation =
  | { kind: "grade"; input: GradeEssayProviderInput }
  | { kind: "rubric"; input: GenerateRubricProviderInput }
  | { kind: "material_context"; input: GenerateMaterialContextProviderInput };
export type OperationResult =
  | ({ kind: "grade" } & ProviderCallResult<MultimodalGradingResult>)
  | ({ kind: "rubric" } & ProviderCallResult<GeneratedRubricV1>)
  | ({ kind: "material_context" } & ProviderCallResult<TaskMaterialContextV1>);
export interface OperationServices {
  now?: () => string;
  monotonicNow?: () => number;
  telemetry?: ProviderTelemetryRecorder;
  runtimeConfig?: GatewayRuntimeConfig;
  onDiagnostic?: SafeGradingDiagnosticSink;
}
export class OperationNormalizationError extends GradingProviderError {
  constructor(
    readonly publicError: {
      code: "provider_invalid_response";
      message: string;
    },
    attempts: ProviderCallResult<unknown>["attempts"],
  ) {
    super("provider_invalid_response", publicError.message, true, undefined, {
      termination: "confirmed",
      attemptObservations: attempts,
    });
  }
}
function mediaMetadata(pages: readonly GatewayImageInput[]) {
  const dimensions = pages.flatMap((p, i) => {
    const d = readSafeImageDimensions(p.buffer, p.mimeType);
    return d.status === "known"
      ? [{ page: i + 1, width: d.width, height: d.height }]
      : [];
  });
  return {
    pageCount: pages.length,
    totalBytes: pages.reduce((sum, p) => sum + p.buffer.length, 0),
    ...(dimensions.length ? { dimensions } : {}),
  };
}
export function executeMultimodalOperation(
  provider: MultimodalProvider,
  op: Extract<MultimodalOperation, { kind: "grade" }>,
  services: OperationServices,
): Promise<Extract<OperationResult, { kind: "grade" }>>;
export function executeMultimodalOperation(
  provider: MultimodalProvider,
  op: Extract<MultimodalOperation, { kind: "rubric" }>,
  services: OperationServices,
): Promise<Extract<OperationResult, { kind: "rubric" }>>;
export function executeMultimodalOperation(
  provider: MultimodalProvider,
  op: Extract<MultimodalOperation, { kind: "material_context" }>,
  services: OperationServices,
): Promise<Extract<OperationResult, { kind: "material_context" }>>;
export function executeMultimodalOperation(
  provider: MultimodalProvider,
  op: MultimodalOperation,
  services: OperationServices,
): Promise<OperationResult>;
export async function executeMultimodalOperation(
  provider: MultimodalProvider,
  op: MultimodalOperation,
  services: OperationServices,
): Promise<OperationResult> {
  const telemetry = services.telemetry ?? createProviderTelemetryRecorder();
  const now = () => {
    const n = (services.monotonicNow ?? performance.now.bind(performance))();
    if (!Number.isFinite(n) || n < 0) throw Error("Invalid monotonic clock");
    return n;
  };
  const stage: ProviderCallStage =
    op.kind === "grade"
      ? op.input.confirmedTranscript === undefined
        ? "essay_grading_images"
        : "essay_regrading_text"
      : op.kind === "rubric"
        ? "rubric_generation"
        : "material_context";
  const config = services.runtimeConfig;
  const context = {
    stage,
    model:
      config?.provider === "deepseek"
        ? (config.deepseek?.model ?? "unconfigured")
        : config?.provider === "openrouter"
          ? (config.openrouter?.model ?? "unconfigured")
          : (config?.kimi.model ?? "unconfigured"),
    reasoningEffort:
      config?.provider === "deepseek" ? ("none" as const) : ("low" as const),
  };
  const operationDiagnosticId = randomUUID(),
    started = now();
  let recorded = false,
    normalizationReported = false;
  const media =
    op.kind === "grade"
      ? {
          ...mediaMetadata(op.input.pages),
          ...(op.input.confirmedTranscript === undefined
            ? {}
            : { confirmedTextCodeUnits: op.input.confirmedTranscript.length }),
        }
      : {};
  try {
    let payload: ProviderCallResult<unknown>;
    if (op.kind === "grade") payload = await provider.gradeEssay(op.input);
    else if (op.kind === "rubric")
      payload = await provider.generateRubric(op.input);
    else payload = await provider.generateMaterialContext(op.input);
    recordUniqueProviderAttempts(
      telemetry,
      { ...context, outcome: "success" },
      payload.attempts,
    );
    const normalizeStarted = now();
    let result: OperationResult;
    if (op.kind === "grade") {
      const value = normalizeMultimodalResult(payload.value, {
        requestId: op.input.requestId,
        essayId: op.input.essayId,
        task: op.input.task,
        provider: "remote",
        pageCount: op.input.pages.length,
        confirmedTranscript: op.input.confirmedTranscript,
        createdAt: (services.now ?? (() => new Date().toISOString()))(),
      });
      if (!value.ok) {
        normalizationReported = true;
        emitSafeGradingDiagnostic(services.onDiagnostic, {
          stage: "normalization",
          diagnosticCode: value.error.diagnosticCode,
        });
        throw new OperationNormalizationError({code: 'provider_invalid_response', message: value.error.message}, payload.attempts);
      }
      result = {
        kind: "grade",
        value: value.result,
        attempts: payload.attempts,
      };
    } else if (op.kind === "rubric") {
      const value = validateGeneratedRubric(payload.value);
      if (!value.ok) {
        normalizationReported = true;
        emitSafeGradingDiagnostic(services.onDiagnostic, {
          stage: "normalization",
          diagnosticCode: "rubric_validation",
        });
        throw new OperationNormalizationError({code: 'provider_invalid_response', message: value.error.message}, payload.attempts);
      }
      result = {
        kind: "rubric",
        value: value.value,
        attempts: payload.attempts,
      };
    } else {
      const value = validateTaskMaterialContext(payload.value);
      if (!value.ok) {
        normalizationReported = true;
        emitSafeGradingDiagnostic(services.onDiagnostic, {
          stage: "normalization",
          diagnosticCode: "material_context_validation",
        });
        throw new OperationNormalizationError(value.error, payload.attempts);
      }
      result = {
        kind: "material_context",
        value: value.value,
        attempts: payload.attempts,
      };
    }
    recordProviderOperation(telemetry, {
      ...context,
      outcome: "success",
      operationDiagnosticId,
      normalizeMs: now() - normalizeStarted,
      totalMs: now() - started,
      ...media,
    });
    recorded = true;
    return result;
  } catch (error) {
    const confirmed =
      error instanceof GradingProviderError &&
      error.details?.termination === "confirmed";
    if (error instanceof GradingProviderError)
      recordUniqueProviderAttempts(
        telemetry,
        { ...context, outcome: confirmed ? "failed" : "result_unknown" },
        error.details?.attemptObservations ?? [],
      );
    if (!recorded)
      recordProviderOperation(telemetry, {
        ...context,
        outcome: confirmed ? "failed" : "result_unknown",
        operationDiagnosticId,
        totalMs: now() - started,
        ...media,
      });
    // A normalized invalid response has already emitted the more precise diagnostic.
    if (!normalizationReported)
      emitSafeGradingDiagnostic(services.onDiagnostic, {
        stage: "provider",
        diagnosticCode:
          error instanceof GradingProviderError
            ? (error.diagnosticCode ?? error.code)
            : "provider_unavailable",
      });
    throw error;
  }
}
