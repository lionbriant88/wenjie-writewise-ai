import { createHash, randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.js";
import type {
  Command,
  UploadInput,
  UploadTicket,
  UploadDto,
  ListQuery,
  Page,
  PageDto,
  ImageMime,
} from "../../../shared/pilotContracts.js";
import type { GatewayImageInput } from "../../../grading-gateway/src/providers/multimodalProviderTypes.js";
import { MAX_RUBRIC_IMAGE_BYTES } from "../../../grading-gateway/src/multipartImages.js";
import { readSafeImageDimensions } from "../../../grading-gateway/src/imageMetadata.js";
import { PilotError, invalid, notFound } from "./errors.js";
import {
  id,
  integer,
  text,
  record,
  validateCommand,
  readListQuery,
} from "./validation.js";
import { runCommand, payloadHash } from "./commands.js";
import { ownedTask } from "./tasks.js";
import type { PrivateStorage } from "./storage.js";
export type UploadRow = Record<string, unknown> & {
  owner_id: string;
  id: string;
  task_id: string;
  path: string;
  purpose: "material" | "essay";
  mime_type: ImageMime;
  size: number;
  label: string;
  state: UploadDto["state"];
  sha256: string | null;
  created_at: Date | string;
};
export async function ownedUpload(
  tx: Queryable,
  ownerId: string,
  uploadId: string,
  lock = false,
): Promise<UploadRow> {
  const row = (
    await tx.query<UploadRow>(
      `SELECT u.* FROM pilot_grading.uploads u JOIN pilot_grading.tasks t ON (t.owner_id=u.owner_id AND t.id=u.task_id) JOIN pilot_auth.accounts a ON a.id=u.owner_id WHERE u.owner_id=$1 AND u.id=$2 AND u.deleted_at IS NULL AND t.deleted_at IS NULL AND a.status='active' AND a.role='teacher'${lock ? " FOR UPDATE OF u" : ""}`,
      [id(ownerId), id(uploadId)],
    )
  ).rows[0];
  return row ?? notFound();
}
function page(row: UploadRow): PageDto {
  return {
    id: row.id,
    uploadId: row.id,
    pageNumber: 1,
    label: row.label,
    mimeType: row.mime_type,
    size: row.size,
  };
}
function verify(
  row: UploadRow,
  object: { bytes: Uint8Array; contentType: string },
): { buffer: Buffer; digest: string } {
  const buffer = Buffer.from(object.bytes);
  if (
    buffer.length !== row.size ||
    buffer.length > MAX_RUBRIC_IMAGE_BYTES ||
    object.contentType !== row.mime_type ||
    readSafeImageDimensions(buffer, row.mime_type).status !== "known"
  )
    throw new PilotError("invalid_image");
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (row.sha256 && row.sha256 !== digest)
    throw new PilotError("image_changed");
  return { buffer, digest };
}
export class PilotUploadService {
  constructor(
    private db: Database,
    private storage: PrivateStorage,
  ) {}
  async reserve(
    ownerId: string,
    taskId: string,
    input: Command<UploadInput>,
  ): Promise<UploadTicket> {
    const c = validateCommand(input, false),
      v = record(c.value, ["purpose", "mimeType", "size", "label"]);
    if (
      !["material", "essay"].includes(String(v.purpose)) ||
      !["image/png", "image/jpeg", "image/webp"].includes(String(v.mimeType))
    )
      return invalid();
    const size = integer(v.size, 1, MAX_RUBRIC_IMAGE_BYTES),
      label = text(v.label, 256);
    const uploadId = await this.db.transaction(async (tx) => {
      await ownedTask(tx, ownerId, taskId);
      const result = await runCommand(
        tx,
        ownerId,
        "upload:reserve:" + taskId,
        c,
        payloadHash(c),
        async () => {
          const task = await ownedTask(tx, ownerId, taskId, true);
          if (
            (v.purpose === "essay" && task.state !== "confirmed") ||
            (v.purpose === "material" && task.state !== "draft")
          )
            return invalid();
          const uploadId = randomUUID(),
            path = randomUUID() + "/" + randomUUID();
          await tx.query(
            "INSERT INTO pilot_grading.uploads(owner_id,task_id,id,path,purpose,mime_type,size,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              ownerId,
              taskId,
              uploadId,
              path,
              v.purpose,
              v.mimeType,
              size,
              label,
            ],
          );
          return uploadId;
        },
      );
      const upload = await ownedUpload(tx, ownerId, result, true);
      if (Date.now() - new Date(upload.created_at).getTime() >= 86400000)
        throw new PilotError("upload_expired", 409);
      await tx.query(
        "UPDATE pilot_grading.uploads SET last_signed_at=now() WHERE owner_id=$1 AND id=$2",
        [ownerId, result],
      );
      return result;
    });
    const upload = await ownedUpload(this.db, ownerId, uploadId);
    return { uploadId, ...(await this.storage.signUpload(upload.path)) };
  }
  async complete(
    ownerId: string,
    uploadId: string,
    input: Command<Record<string, never>>,
  ): Promise<PageDto> {
    const c = validateCommand(input, false);
    record(c.value, []);
    const row = await ownedUpload(this.db, ownerId, uploadId);
    const { digest } = verify(
      row,
      await this.storage.read(row.path, AbortSignal.timeout(30000)),
    );
    return this.db.transaction(async (tx) => {
      await ownedUpload(tx, ownerId, uploadId);
      return runCommand(
        tx,
        ownerId,
        "upload:complete:" + uploadId,
        c,
        payloadHash(c),
        async () => {
          const current = await ownedUpload(tx, ownerId, uploadId, true);
          if (current.sha256 && current.sha256 !== digest)
            throw new PilotError("image_changed");
          await tx.query(
            "UPDATE pilot_grading.uploads SET sha256=$3,state=CASE WHEN state='attached' THEN state ELSE 'verified' END,verified_at=coalesce(verified_at,now()) WHERE owner_id=$1 AND id=$2",
            [ownerId, uploadId, digest],
          );
          return page(current);
        },
      );
    });
  }
  async list(
    ownerId: string,
    taskId: string,
    query: ListQuery,
  ): Promise<Page<UploadDto>> {
    await ownedTask(this.db, ownerId, taskId);
    const { cursor, limit } = readListQuery(query);
    const rows = (
      await this.db.query<UploadRow>(
        "SELECT * FROM pilot_grading.uploads WHERE owner_id=$1 AND task_id=$2 AND deleted_at IS NULL AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4",
        [ownerId, taskId, cursor ?? null, limit + 1],
      )
    ).rows;
    return {
      items: rows
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          taskId: r.task_id,
          purpose: r.purpose,
          mimeType: r.mime_type,
          size: r.size,
          label: r.label,
          state: r.state,
          createdAt: new Date(r.created_at).toISOString(),
        })),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async readUrl(
    ownerId: string,
    uploadId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const row = await ownedUpload(this.db, ownerId, uploadId);
    if (!row.sha256) throw new PilotError("upload_incomplete", 409);
    return {
      url: await this.storage.signRead(row.path, 60),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  }
  async loadVerified(
    ownerId: string,
    uploadId: string,
    signal: AbortSignal,
  ): Promise<GatewayImageInput> {
    const row = await ownedUpload(this.db, ownerId, uploadId);
    if (!row.sha256 || row.state === "reserved")
      throw new PilotError("upload_incomplete", 409);
    const { buffer } = verify(row, await this.storage.read(row.path, signal));
    return { pageId: row.id, mimeType: row.mime_type, buffer };
  }
}
