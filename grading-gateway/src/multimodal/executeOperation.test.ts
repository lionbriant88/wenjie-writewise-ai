import { describe, expect, it } from "vitest";
import { executeMultimodalOperation } from "./executeOperation.js";
import type { MultimodalProvider } from "../providers/multimodalProviderTypes.js";
import { GradingProviderError } from "../providers/providerTypes.js";
import { createProviderTelemetryRecorder } from "../providerTelemetry.js";
const rubric = {
  taskName: "Synthetic task",
  materialSummary: "Write a response.",
  writingRequirements: ["Write a story."],
  constraints: [],
  dimensions: [
    {
      id: "content",
      name: "Content",
      description: "Content",
      weight: 95,
      deductionFocus: [],
      sourceEvidence: [],
    },
    {
      id: "legibility",
      name: "Legibility",
      description: "Legibility",
      weight: 5,
      deductionFocus: [],
      sourceEvidence: [],
    },
  ],
  reviewWarnings: [],
};
const task = {
  taskId: "task-execution",
  fullScore: 15,
  materialSummary: rubric.materialSummary,
  writingRequirements: rubric.writingRequirements,
  constraints: [],
  rubric,
};
const payload = {
  transcript: "I have a pen.",
  recognitionWarnings: [],
  printedTextExcluded: true,
  reportedTotalScore: 15,
  dimensionScores: [
    {
      dimensionId: "content",
      score: 14.25,
      reason: "Complete",
      evidence: "I have a pen.",
      relatedIssueKeys: [],
    },
    {
      dimensionId: "legibility",
      score: 0.75,
      reason: "Clear",
      evidence: "I have a pen.",
      relatedIssueKeys: [],
    },
  ],
  issues: [],
  sentenceRevisions: [],
  expressionUpgrades: [],
  fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] },
  legibilityIssues: [],
  overallComment: "Clear.",
};
const input = () => ({
  requestId: "request-execution",
  essayId: "essay-execution",
  task,
  pages: [
    {
      pageId: "page-1",
      mimeType: "image/png" as const,
      buffer: Buffer.from("synthetic"),
    },
  ],
  signal: new AbortController().signal,
});
const provider = (
  overrides: Partial<MultimodalProvider> = {},
): MultimodalProvider => ({
  gradeEssay: async () => ({ value: payload, attempts: [] }),
  generateRubric: async () => ({ value: rubric, attempts: [] }),
  generateMaterialContext: async () => ({
    value: {
      materialSummary: "Synthetic",
      writingRequirements: ["Write."],
      constraints: [],
      reviewWarnings: [],
    },
    attempts: [],
  }),
  ...overrides,
});
describe("shared single operation execution", () => {
  it("preservesV2ResultAndNormalization", async () => {
    const result = await executeMultimodalOperation(
      provider(),
      { kind: "grade", input: input() },
      { now: () => "2026-09-28T00:00:00.000Z" },
    );
    expect(result.value).toMatchObject({
      resultVersion: "grading-result-v2",
      provider: "remote",
      requestId: "request-execution",
      transcript: "I have a pen.",
      totalScore: 15,
    });
    await expect(
      executeMultimodalOperation(
        provider({
          gradeEssay: async () => ({
            value: { ...payload, dimensionScores: [] },
            attempts: [],
          }),
        }),
        { kind: "grade", input: input() },
        {},
      ),
    ).rejects.toMatchObject({
      code: "provider_invalid_response",
      details: { termination: "confirmed" },
    });
  });
  it("runsOneRubricCompletion", async () => {
    let calls = 0;
    const p = provider({
      generateRubric: async () => {
        calls++;
        return { value: rubric, attempts: [] };
      },
    });
    const result = await executeMultimodalOperation(
      p,
      {
        kind: "rubric",
        input: {
          requestId: "rubric",
          fullScore: 15,
          writingRequirement: "Write.",
          materials: [],
          signal: new AbortController().signal,
        },
      },
      {},
    );
    expect(result.value.dimensions.map((d) => d.weight)).toEqual([95, 5]);
    expect(calls).toBe(1);
  });
  it("usesZeroImagesForConfirmedText", async () => {
    let captured = -1;
    const p = provider({
      gradeEssay: async (i) => {
        captured = i.pages.length;
        expect(i.confirmedTranscript).toBe("I have a pen.");
        return { value: payload, attempts: [] };
      },
    });
    await executeMultimodalOperation(
      p,
      {
        kind: "grade",
        input: { ...input(), pages: [], confirmedTranscript: "I have a pen." },
      },
      {},
    );
    expect(captured).toBe(0);
  });
  it("keepsUnknownTerminationAndSafeDiagnostics", async () => {
    const diagnostics: unknown[] = [];
    let calls = 0;
    const metrics = createProviderTelemetryRecorder();
    const error = new GradingProviderError(
      "provider_timeout",
      "PRIVATE raw content",
      false,
      undefined,
      { termination: "unknown" },
    );
    await expect(
      executeMultimodalOperation(
        provider({
          gradeEssay: async () => {
            calls++;
            throw error;
          },
        }),
        { kind: "grade", input: input() },
        { telemetry: metrics, onDiagnostic: (d) => diagnostics.push(d) },
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
    expect(diagnostics).toEqual([
      { stage: "provider", diagnosticCode: "provider_timeout" },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE");
  });
  it("reportsProviderRejectedPayloadWithoutLeakingItsMessage", async () => {
    const diagnostics: unknown[] = [];
    const error = new GradingProviderError(
      "provider_invalid_response",
      "secret provider text",
      true,
      undefined,
      { termination: "confirmed" },
    );
    await expect(
      executeMultimodalOperation(
        provider({
          gradeEssay: async () => {
            throw error;
          },
        }),
        { kind: "grade", input: input() },
        { onDiagnostic: (d) => diagnostics.push(d) },
      ),
    ).rejects.toBe(error);
    expect(diagnostics).toEqual([
      { stage: "provider", diagnosticCode: "provider_invalid_response" },
    ]);
  });
});
