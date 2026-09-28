import type {
  Command,
  ListQuery,
  TaskDraftInput,
  MaterialRef,
} from "../../../shared/pilotContracts.js";
import { validateTaskMaterialContext } from "../../../grading-gateway/src/multimodal/materialContextContract.js";
import { invalid } from "./errors.js";
export function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    return invalid();
  return value as Record<string, unknown>;
}
export function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return invalid();
  return value.toLowerCase();
}
export function text(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length > max ||
    (!empty && !value.trim())
  )
    return invalid();
  return value.trim();
}
export function integer(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    return invalid();
  return value;
}
export function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
export function validateCommand(
  value: unknown,
  edit: boolean,
): Command<unknown> {
  const v = record(value, ["commandId", "expectedRevision", "value"]);
  if (!Object.hasOwn(v, "value")) return invalid();
  return {
    commandId: id(v.commandId),
    value: v.value,
    ...(edit || v.expectedRevision !== undefined
      ? { expectedRevision: integer(v.expectedRevision, 1) }
      : {}),
  };
}
export function readListQuery(
  query: ListQuery,
): Required<Pick<ListQuery, "limit">> & Pick<ListQuery, "cursor"> {
  return {
    limit: query.limit === undefined ? 50 : integer(query.limit, 1, 50),
    ...(query.cursor ? { cursor: id(query.cursor) } : {}),
  };
}
export function validateDraft(value: unknown): TaskDraftInput {
  const v = record(value, [
    "taskName",
    "fullScore",
    "writingRequirement",
    "dimensions",
    "source",
    "materialContext",
    "materialProcessingStatus",
    "materialRefs",
  ]);
  if (
    !["teacher", "ai"].includes(String(v.source)) ||
    !["none", "ready", "failed"].includes(String(v.materialProcessingStatus))
  )
    return invalid();
  let materialContext: TaskDraftInput["materialContext"] = null;
  if (v.materialContext !== null) {
    const result = validateTaskMaterialContext(v.materialContext);
    if (!result.ok) return invalid();
    materialContext = result.value;
  }
  return {
    taskName: text(v.taskName, 2000, true),
    fullScore: v.fullScore === null ? null : integer(v.fullScore, 0, 100),
    writingRequirement: text(v.writingRequirement, 10000, true),
    source: v.source as TaskDraftInput["source"],
    materialProcessingStatus:
      v.materialProcessingStatus as TaskDraftInput["materialProcessingStatus"],
    materialContext,
    dimensions: list(v.dimensions, 10).map((d) => {
      const r = record(d, [
        "id",
        "name",
        "description",
        "weight",
        "deductionFocus",
        "sourceEvidence",
      ]);
      if (
        typeof r.weight !== "number" ||
        !Number.isFinite(r.weight) ||
        r.weight < 0 ||
        r.weight > 100
      )
        return invalid();
      return {
        id: text(r.id, 128),
        name: text(r.name, 256, true),
        description: text(r.description, 2000, true),
        weight: r.weight,
        deductionFocus: list(r.deductionFocus, 50).map((x) => text(x, 1000)),
        sourceEvidence: list(r.sourceEvidence, 50).map((x) => text(x, 5000)),
      };
    }),
    materialRefs: list(v.materialRefs, 10).map((ref): MaterialRef => {
      const r = record(ref, [
        "kind",
        "uploadId",
        "id",
        "displayName",
        "text",
        "warnings",
      ]);
      if (r.kind === "image") {
        record(ref, ["kind", "uploadId"]);
        return { kind: "image", uploadId: id(r.uploadId) };
      }
      if (r.kind !== "text") return invalid();
      record(ref, ["kind", "id", "displayName", "text", "warnings"]);
      const warnings = list(r.warnings, 2);
      if (
        warnings.some(
          (x) => x !== "docx_body_only" && x !== "docx_parser_warning",
        )
      )
        return invalid();
      return {
        kind: "text",
        id: id(r.id),
        displayName: text(r.displayName, 256),
        text: text(r.text, 30000),
        warnings: warnings as ("docx_body_only" | "docx_parser_warning")[],
      };
    }),
  };
}
