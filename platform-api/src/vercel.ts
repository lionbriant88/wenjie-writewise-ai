import type { IncomingMessage, ServerResponse } from "node:http";
import { getRuntimeApp } from "./runtime.js";

function safeBootstrapError(error: unknown): Record<string, string> {
  if (!error || typeof error !== "object") return { name: "unknown" };
  const value = error as Record<string, unknown>;
  const safe: Record<string, string> = {};
  for (const key of ["name", "code", "syscall", "diagnosticCode"] as const) {
    if (typeof value[key] === "string") safe[key] = value[key];
  }
  return safe;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const app = await getRuntimeApp();
    app(req, res);
  } catch (error) {
    console.error("platform_api_bootstrap_failed", safeBootstrapError(error));
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: {
          code: "service_unavailable",
          message: "服务暂不可用，请稍后重试。",
        },
      }),
    );
  }
}
