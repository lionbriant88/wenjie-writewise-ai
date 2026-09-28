import type { Queryable } from "../database.js";
import type { MaterialRef } from "../../../shared/pilotContracts.js";
import { notFound, invalid } from "./errors.js";
export async function syncMaterialUploads(
  tx: Queryable,
  ownerId: string,
  taskId: string,
  refs: MaterialRef[],
): Promise<void> {
  const ids = refs
    .filter(
      (r): r is Extract<MaterialRef, { kind: "image" }> => r.kind === "image",
    )
    .map((r) => r.uploadId);
  if (new Set(ids).size !== ids.length) return invalid();
  for (const uploadId of ids) {
    const row = (
      await tx.query(
        "SELECT id FROM pilot_grading.uploads WHERE owner_id=$1 AND task_id=$2 AND id=$3 AND purpose='material' AND state IN ('verified','attached') AND deleted_at IS NULL FOR UPDATE",
        [ownerId, taskId, uploadId],
      )
    ).rows[0];
    if (!row) return notFound();
  }
  await tx.query(
    "DELETE FROM pilot_grading.task_material_uploads WHERE owner_id=$1 AND task_id=$2",
    [ownerId, taskId],
  );
  await tx.query(
    "UPDATE pilot_grading.uploads SET state='verified' WHERE owner_id=$1 AND task_id=$2 AND purpose='material' AND state='attached'",
    [ownerId, taskId],
  );
  for (const uploadId of ids) {
    await tx.query(
      "INSERT INTO pilot_grading.task_material_uploads(owner_id,task_id,upload_id) VALUES($1,$2,$3)",
      [ownerId, taskId, uploadId],
    );
    await tx.query(
      "UPDATE pilot_grading.uploads SET state='attached' WHERE owner_id=$1 AND id=$2",
      [ownerId, uploadId],
    );
  }
}
