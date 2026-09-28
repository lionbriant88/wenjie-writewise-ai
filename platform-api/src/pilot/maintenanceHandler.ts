import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RecoveryDeps } from "./recovery.js";
import { recoverPilotWork } from "./recovery.js";
export function createMaintenanceHandler(
  load: () => Promise<RecoveryDeps>,
  secret: () => string | undefined = () => process.env.CRON_SECRET,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const key = secret(),
      expected = Buffer.from("Bearer " + (key ?? "")),
      actual = Buffer.from(req.headers.authorization ?? "");
    res.setHeader("Cache-Control", "no-store");
    if (
      req.method !== "GET" ||
      !key ||
      key.length < 24 ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.statusCode = 401;
      res.end();
      return;
    }
    try {
      await recoverPilotWork(await load(), 50);
      res.statusCode = 204;
      res.end();
    } catch {
      res.statusCode = 503;
      res.end();
    }
  };
}
