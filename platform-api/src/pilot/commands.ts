import { createHash } from "node:crypto";
import type { Queryable } from "../database.js";
import type { Command } from "../../../shared/pilotContracts.js";
import { PilotError } from "./errors.js";
export function payloadHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function runCommand<T>(
  tx: Queryable,
  ownerId: string,
  operation: string,
  command: Command<unknown>,
  hash: string,
  apply: () => Promise<T>,
): Promise<T> {
  // Serializes commands for one teacher, including commits whose responses were lost.
  const owner = (
    await tx.query(
      "SELECT id FROM pilot_auth.accounts WHERE id=$1 AND role='teacher' AND status='active' FOR UPDATE",
      [ownerId],
    )
  ).rows[0];
  if (!owner) throw new PilotError("unauthorized", 401);
  const receipt = (
    await tx.query<{ payload_hash: string; response: T }>(
      "SELECT payload_hash,response FROM pilot_grading.command_receipts WHERE owner_id=$1 AND operation=$2 AND command_id=$3",
      [ownerId, operation, command.commandId],
    )
  ).rows[0];
  if (receipt) {
    if (receipt.payload_hash !== hash)
      throw new PilotError("command_conflict", 409);
    return receipt.response;
  }
  const response = await apply();
  await tx.query(
    "INSERT INTO pilot_grading.command_receipts(owner_id,operation,command_id,payload_hash,response) VALUES($1,$2,$3,$4,$5)",
    [ownerId, operation, command.commandId, hash, JSON.stringify(response)],
  );
  return response;
}
