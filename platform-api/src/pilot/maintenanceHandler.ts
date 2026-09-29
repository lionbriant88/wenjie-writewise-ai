import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RecoveryDeps } from "./recovery.js";
import { recoverPilotWork } from "./recovery.js";
import type { MigrationGate } from "./migrationGate.js";
export function createMaintenanceHandler(
  load: () => Promise<RecoveryDeps & { migrationGate?: MigrationGate }>,
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
      const runtime = await load();
      if (runtime.migrationGate)
        await runtime.migrationGate.run(() => recoverPilotWork(runtime, 50));
      else await recoverPilotWork(runtime, 50);
      res.statusCode = 204;
      res.end();
    } catch {
      res.statusCode = 503;
      res.end();
    }
  };
}
