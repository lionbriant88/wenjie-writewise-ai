import type { IncomingMessage, ServerResponse } from "node:http";
import { getRuntimeApp } from "./runtime.js";
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const app = await getRuntimeApp();
    app(req, res);
  } catch {
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
