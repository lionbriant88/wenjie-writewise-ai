import { randomUUID } from "node:crypto";
import { createLocalDatabase } from "../localDatabase.js";
import { migrate } from "../migrate.js";
import { migratePilot } from "./migrate.js";

export const ownerA = "00000000-0000-4000-8000-000000000001";
export const ownerB = "00000000-0000-4000-8000-000000000002";
export const command = <T>(value: T, expectedRevision?: number) => ({
  commandId: randomUUID(),
  value,
  ...(expectedRevision ? { expectedRevision } : {}),
});
export const validDraft = () => ({
  taskName: "",
  fullScore: 15,
  writingRequirement: "Write a short story.",
  source: "teacher" as const,
  materialContext: null,
  materialProcessingStatus: "none" as const,
  materialRefs: [],
  dimensions: ["content", "language", "structure", "legibility"].map(
    (id, i) => ({
      id,
      name: id,
      description: "Assess " + id,
      weight: [40, 40, 15, 5][i],
      deductionFocus: [],
      sourceEvidence: [],
    }),
  ),
});
export async function pilotTestDb() {
  const db = createLocalDatabase();
  await migrate(db);
  await db.query(
    "INSERT INTO pilot_auth.batches(id,digest) VALUES('teacher-pilot-v1',$1)",
    ["0".repeat(64)],
  );
  for (const [i, id] of [ownerA, ownerB].entries())
    await db.query(
      "INSERT INTO pilot_auth.accounts(id,batch_id,username,display_name,role,password_hash) VALUES($1,'teacher-pilot-v1',$2,$3,'teacher','synthetic-hash')",
      [id, "wj_" + String(i + 1).padStart(24, "0"), "Synthetic " + i],
    );
  await migratePilot(db);
  return db;
}
