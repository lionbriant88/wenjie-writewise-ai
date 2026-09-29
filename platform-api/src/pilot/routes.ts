import { Router, json, type Request, type Response } from "express";
import type {
  ListQuery,
  PilotCapabilities,
} from "../../../shared/pilotContracts.js";
import { PilotTaskRepository } from "./tasks.js";
import { PilotEssayRepository } from "./essays.js";
import { PilotJobRepository } from "./jobs.js";
import { PilotCleanupService } from "./cleanup.js";
import { recoverPilotWork } from "./recovery.js";
import { id, record, readListQuery } from "./validation.js";
import { PilotError } from "./errors.js";
import type { PilotRuntime } from "./runtime.js";
import type { MigrationGate } from "./migrationGate.js";
import type { DiskStorage } from "./diskStorage.js";
import { createFileRouter } from "./fileRoutes.js";

function query(req: Request): ListQuery {
  const q = record(req.query, ["limit", "cursor"]);
  if (
    q.limit !== undefined &&
    (typeof q.limit !== "string" || !/^\d+$/.test(q.limit))
  )
    throw new PilotError("invalid_request");
  return readListQuery({
    ...(q.limit === undefined ? {} : { limit: Number(q.limit) }),
    ...(q.cursor === undefined ? {} : { cursor: id(q.cursor) }),
  });
}
const owner = (res: Response): string => res.locals.user.id;
const resource = (req: Request) => id(req.params.id);
export interface PilotRouterOptions {
  gate?: MigrationGate;
  files?: { storage: DiskStorage; gate: MigrationGate };
}
export function createPilotRouter(
  runtime?: PilotRuntime,
  options: PilotRouterOptions = {},
): Router {
  const router = Router();
  type Handler = (req: Request, res: Response) => Promise<unknown>;
  const add =
    (method: "get" | "post" | "patch" | "put" | "delete") =>
    (path: string, handler: Handler) =>
      router[method](path, async (req, res) => {
        // Hold admission through storage, signing and queue publication as well as SQL.
        if (options.gate) await options.gate.run(() => handler(req, res));
        else await handler(req, res);
      });
  const routes = {
    get: add("get"),
    post: add("post"),
    patch: add("patch"),
    put: add("put"),
    delete: add("delete"),
  };
  routes.get("/capabilities", async (_req, res) => {
    let capability: PilotCapabilities = {
      teacherMvp: false,
      aiAvailable: false,
      queueState: "paused",
    };
    if (runtime) {
      const gate = (
        await runtime.db.query<{
          pause_reason: string | null;
          active_execution_id: string | null;
        }>(
          "SELECT pause_reason,active_execution_id FROM pilot_grading.provider_gate WHERE singleton",
        )
      ).rows[0];
      capability = {
        teacherMvp: true,
        aiAvailable: !!gate && !gate.pause_reason,
        queueState: gate?.pause_reason
          ? "paused"
          : gate?.active_execution_id
            ? "waiting"
            : "ready",
      };
    }
    res.json(capability);
  });
  router.use((_req, _res, next) =>
    next(runtime ? undefined : new PilotError("pilot_not_configured", 503)),
  );
  if (runtime && options.files)
    router.use(createFileRouter({ db: runtime.db, ...options.files }));
  router.use(json({ limit: "2mb", strict: true }));
  if (!runtime) return router;
  const recoveryRuntime = runtime;
  const tasks = new PilotTaskRepository(runtime.db),
    essays = new PilotEssayRepository(runtime.db),
    jobs = new PilotJobRepository(runtime.db),
    cleanup = new PilotCleanupService(runtime.db, runtime.storage);
  // The command is committed before publication. A failed send leaves the durable outbox for recovery.
  async function recover(res: Response) {
    try {
      await recoverPilotWork({ ...recoveryRuntime, ownerId: owner(res) }, 50);
    } catch {
      /* A later teacher request or maintenance resumes the same job. */
    }
  }
  routes.get("/tasks", async (req, res) => {
    await recover(res);
    res.json(await tasks.list(owner(res), query(req)));
  });
  routes.post("/tasks", async (req, res) =>
    res.status(201).json(await tasks.createDraft(owner(res), req.body)),
  );
  routes.get("/tasks/:id", async (req, res) => {
    const result = await tasks.get(owner(res), resource(req));
    await recover(res);
    res.json(result);
  });
  routes.patch("/tasks/:id", async (req, res) =>
    res.json(await tasks.saveDraft(owner(res), resource(req), req.body)),
  );
  routes.delete("/tasks/:id", async (req, res) => {
    await cleanup.deleteTask(owner(res), resource(req), req.body);
    await recover(res);
    res.json({ deleted: true });
  });
  routes.post("/tasks/:id/confirm", async (req, res) =>
    res.json(await tasks.confirm(owner(res), resource(req), req.body)),
  );
  routes.get("/tasks/:id/uploads", async (req, res) =>
    res.json(await runtime.uploads.list(owner(res), resource(req), query(req))),
  );
  routes.post("/tasks/:id/uploads", async (req, res) =>
    res
      .status(201)
      .json(await runtime.uploads.reserve(owner(res), resource(req), req.body)),
  );
  routes.post("/uploads/:id/complete", async (req, res) =>
    res.json(
      await runtime.uploads.complete(owner(res), resource(req), req.body),
    ),
  );
  routes.get("/uploads/:id/read-url", async (req, res) =>
    res.json(await runtime.uploads.readUrl(owner(res), resource(req))),
  );
  routes.get("/tasks/:id/essays", async (req, res) => {
    const result = await essays.list(owner(res), resource(req), query(req));
    await recover(res);
    res.json(result);
  });
  routes.post("/tasks/:id/essays", async (req, res) =>
    res
      .status(201)
      .json(await essays.attach(owner(res), resource(req), req.body)),
  );
  routes.get("/essays/:id", async (req, res) =>
    res.json(await essays.get(owner(res), resource(req))),
  );
  routes.patch("/essays/:id/transcript", async (req, res) =>
    res.json(await essays.saveTranscript(owner(res), resource(req), req.body)),
  );
  routes.put("/essays/:id/review", async (req, res) =>
    res.json(await essays.saveReview(owner(res), resource(req), req.body)),
  );
  routes.put("/essays/:id/manual", async (req, res) =>
    res.json(await essays.markManual(owner(res), resource(req), req.body)),
  );
  routes.post("/tasks/:id/grade", async (req, res) => {
    const result = await jobs.enqueueTask(owner(res), resource(req), req.body);
    await recover(res);
    res.status(202).json(result);
  });
  routes.get("/tasks/:id/assist", async (req, res) => {
    const result = await jobs.listAssistance(owner(res), resource(req));
    await recover(res);
    res.json(result);
  });
  routes.post("/tasks/:id/assist", async (req, res) => {
    const result = await jobs.enqueueMaterial(
      owner(res),
      resource(req),
      req.body,
    );
    await recover(res);
    res.status(202).json(result);
  });
  routes.get("/jobs/:id", async (req, res) => {
    const result = await jobs.get(owner(res), resource(req));
    await recover(res);
    res.json(result);
  });
  routes.post("/jobs/:id/retry", async (req, res) => {
    const result = await jobs.retryKnown(owner(res), resource(req), req.body);
    await recover(res);
    res.status(202).json(result);
  });
  return router;
}
