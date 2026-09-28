import type {
  ConfirmedTaskPackageV2,
  GeneratedRubricDimensionV1,
  TaskMaterialContextV1,
  GeneratedRubricV1,
} from "../grading-gateway/src/multimodal/types.js";
import type { MultimodalGradingResult } from "../grading-gateway/src/multimodal/normalizeMultimodalResult.js";
export type Id = string;
export type Revision = number;
export interface Command<T> {
  commandId: Id;
  expectedRevision?: Revision;
  value: T;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface ListQuery {
  limit?: number;
  cursor?: string;
}
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export type MaterialRef =
  | { kind: "image"; uploadId: Id }
  | {
      kind: "text";
      id: Id;
      displayName: string;
      text: string;
      warnings: ("docx_body_only" | "docx_parser_warning")[];
    };
export interface TaskDraftInput {
  taskName: string;
  fullScore: number | null;
  writingRequirement: string;
  dimensions: GeneratedRubricDimensionV1[];
  source: "teacher" | "ai";
  materialContext: TaskMaterialContextV1 | null;
  materialProcessingStatus: "none" | "ready" | "failed";
  materialRefs: MaterialRef[];
}
export interface TaskDto {
  id: Id;
  revision: Revision;
  rubricRevision: number;
  state: "draft" | "confirmed";
  draft: TaskDraftInput;
  confirmedPackage: ConfirmedTaskPackageV2 | null;
  counts: { total: number; completed: number; exceptions: number };
  createdAt: string;
  updatedAt: string;
}
export interface UploadInput {
  purpose: "material" | "essay";
  mimeType: ImageMime;
  size: number;
  label: string;
}
export interface UploadTicket {
  uploadId: Id;
  url: string;
  expiresAt: string;
}
export interface UploadDto extends UploadInput {
  id: Id;
  taskId: Id;
  state: "reserved" | "verified" | "attached";
  createdAt: string;
}
export interface PageDto {
  id: Id;
  uploadId: Id;
  pageNumber: number;
  label: string;
  mimeType: ImageMime;
  size: number;
}
export interface TeacherReviewInput {
  dimensionScores: { dimensionId: string; score: number }[];
  overallComment: string;
  teacherSuggestion: string;
  confirm: boolean;
}
export interface ResultDto {
  resultRevision: number;
  sourceRevision: number;
  rubricRevision: number;
  ai: MultimodalGradingResult;
  review: TeacherReviewInput | null;
  updatedAt: string;
}
export interface EssayDto {
  id: Id;
  taskId: Id;
  revision: Revision;
  sourceRevision: number;
  studentName: string;
  essayNumber: number;
  pages: PageDto[];
  confirmedTranscript: string | null;
  currentJob: JobDto | null;
  currentResult: ResultDto | null;
  teacherReviewed: boolean;
  manualReviewRequired: boolean;
}
export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "result_unknown"
  | "cancelled";
export interface JobDto {
  id: Id;
  kind: "grade" | "material_context" | "rubric";
  state: JobState;
  errorCode: string | null;
  retryable: boolean;
  revision: Revision;
  retryAt: string | null;
  createdAt: string;
  updatedAt: string;
  result?: TaskMaterialContextV1 | GeneratedRubricV1;
}
export interface PilotCapabilities {
  teacherMvp: boolean;
  aiAvailable: boolean;
  queueState: "ready" | "paused" | "waiting";
}
