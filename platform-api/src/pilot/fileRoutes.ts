import { Router, type Request, type Response } from "express";
import type { Database, Queryable } from "../database.js";
import type { DiskStorage } from "./diskStorage.js";
import type { MigrationGate } from "./migrationGate.js";
import { checkedFilePath } from "./fileTickets.js";
import { PilotError, notFound, invalid } from "./errors.js";
import { PilotUploadService, type UploadRow } from "./uploads.js";
import { id, record } from "./validation.js";

/** Mount behind teacher session/Origin/CSRF middleware, before any body parser. */
export function createFileRouter({
  db,
  storage,
  gate,
}: {
  db: Database;
  storage: DiskStorage;
  gate: MigrationGate;
}): Router {
  const router = Router(),
    uploads = new PilotUploadService(db, storage);
  let receiving = 0;
  async function ownedFile(
    queryable: Queryable,
    ownerId: string,
    path: string,
    lock: boolean,
  ): Promise<UploadRow> {
    return (
      (
        await queryable.query<UploadRow>(
          "SELECT u.* FROM pilot_grading.uploads u JOIN pilot_grading.tasks t ON (t.owner_id=u.owner_id AND t.id=u.task_id) JOIN pilot_auth.accounts a ON a.id=u.owner_id WHERE u.owner_id=$1 AND u.path=$2 AND u.deleted_at IS NULL AND u.purged_at IS NULL AND t.deleted_at IS NULL AND a.status='active' AND a.role='teacher'" +
            (lock ? " FOR UPDATE OF u" : ""),
          [ownerId, path],
        )
      ).rows[0] ?? notFound()
    );
  }
  async function handle(req: Request, res: Response, method: "PUT" | "GET") {
    if (req.method !== method) throw new PilotError("not_found", 404);
    const path = checkedFilePath(
      `${id(req.params.first)}/${id(req.params.second)}`,
    );
    const query = record(req.query, ["expires", "signature"]);
    if (
      typeof query.expires !== "string" ||
      typeof query.signature !== "string"
    )
      throw new PilotError("invalid_ticket", 403);
    storage.verifyTicket(method, path, query.expires, query.signature);
    const ownerId = id(res.locals.user?.id);
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once("aborted", abort);
    res.once("close", abort);
    try {
      await gate.run(async () => {
        if (method === "GET") {
          const row = await ownedFile(db, ownerId, path, false);
          const image = await uploads.loadVerified(
            ownerId,
            row.id,
            controller.signal,
          );
          res.set("Cache-Control", "private, no-store");
          res.set("X-Content-Type-Options", "nosniff");
          res.type(image.mimeType).send(image.buffer);
          return;
        }
        if (receiving >= 2) throw new PilotError("upload_busy", 503);
        receiving++;
        try {
          await db.transaction(async (tx) => {
            const row = await ownedFile(tx, ownerId, path, true);
            if (row.state !== "reserved")
              throw new PilotError("upload_exists", 409);
            if (Date.now() - new Date(row.created_at).getTime() >= 86400000)
              throw new PilotError("upload_expired", 409);
            if (
              req.get("Content-Type") !== row.mime_type ||
              req.get("Content-Encoding") ||
              (req.get("Content-Length") !== undefined &&
                req.get("Content-Length") !== String(row.size))
            )
              invalid();
            await storage.put(
              path,
              req,
              { size: row.size, contentType: row.mime_type },
              controller.signal,
            );
          });
          res.status(201).end();
        } finally {
          receiving--;
        }
      });
    } finally {
      req.removeListener("aborted", abort);
      res.removeListener("close", abort);
    }
  }
  router.put("/files/:first/:second", async (req, res) =>
    handle(req, res, "PUT"),
  );
  router.get("/files/:first/:second", async (req, res) =>
    handle(req, res, "GET"),
  );
  return router;
}
