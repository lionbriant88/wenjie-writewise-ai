import type { RequestHandler } from "express";
import { parseGatewayRuntimeConfig } from "../../grading-gateway/src/gatewayRuntimeConfig.js";
import { getMultimodalProvider } from "../../grading-gateway/src/providers/index.js";
import { createServer } from "../../grading-gateway/src/server.js";
import { createSafeDiagnosticStderrSink } from "../../grading-gateway/src/safeDiagnostics.js";

const DEFAULT_MODEL = "dots-studio/dots-3-note-preview:free";

function gatewayEnvironment(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return {
    GRADING_PROVIDER: "openrouter",
    GRADING_RUBRIC_STRATEGY: "single-pass-v1",
    GRADING_ESSAY_PROMPT_PROFILE: "optimized-v1",
    GRADING_EXECUTION_REGISTRY: "memory-v1",
    GRADING_MAX_CONCURRENT_PROVIDER_CALLS: "1",
    GRADING_HTTP_DEADLINE_MS: "260000",
    GRADING_PROVIDER_FINAL_DEADLINE_MS: "290000",
    GRADING_PROVIDER_SETTLEMENT_GRACE_MS: "10000",
    GRADING_REGISTRY_TERMINAL_TTL_MS: "86400000",
    GRADING_REGISTRY_MAX_ENTRIES: "2000",
    GRADING_PROVIDER_MAX_ATTEMPTS: "2",
    GRADING_RATE_LIMIT_MAX_REQUEUES: "5",
    GRADING_RETRY_BASE_MS: "2000",
    GRADING_RETRY_CAP_MS: "60000",
    GRADING_RETRY_AFTER_PAUSE_MS: "900000",
    CLASS_REVIEW_SYNTHESIS_MODE: "disabled",
    OPENROUTER_MODEL: env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
    OPENROUTER_MAX_COMPLETION_TOKENS: env.OPENROUTER_MAX_COMPLETION_TOKENS?.trim() || "16384",
  };
}

export function createVercelGradingApp(
  env: NodeJS.ProcessEnv,
  allowedOrigin: string,
): RequestHandler | undefined {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return undefined;
  try {
    const runtimeConfig = parseGatewayRuntimeConfig(gatewayEnvironment(env));
    const multimodalProvider = getMultimodalProvider(runtimeConfig, { apiKey });
    return createServer({
      runtimeConfig, multimodalProvider, allowedOrigin,
      onDiagnostic: createSafeDiagnosticStderrSink("1", (line) => console.error(line)),
    });
  } catch {
    return undefined;
  }
}
