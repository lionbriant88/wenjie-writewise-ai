import { randomUUID } from "node:crypto";
import type { Database } from "../database.js";
import { PilotTaskRepository } from "./tasks.js";
import { command, ownerA, validDraft } from "./testSupport.js";
import { PilotEssayRepository } from "./essays.js";
import { executeMultimodalOperation } from "../../../grading-gateway/src/multimodal/executeOperation.js";
import type { ConfirmedTaskPackageV2 } from "../../../grading-gateway/src/multimodal/types.js";
export async function seedEssay(db: Database, owner = ownerA) {
  const tasks = new PilotTaskRepository(db),
    d = await tasks.createDraft(owner, command(validDraft()));
  const task = await tasks.confirm(owner, d.id, command({}, d.revision));
  const uploadId = randomUUID();
  await db.query(
    "INSERT INTO pilot_grading.uploads(owner_id,task_id,id,path,purpose,mime_type,size,label,state,sha256) VALUES($1,$2,$3,$4,'essay','image/png',20,'Synthetic','verified',$5)",
    [
      owner,
      task.id,
      uploadId,
      randomUUID() + "/" + randomUUID(),
      "0".repeat(64),
    ],
  );
  const essays = new PilotEssayRepository(db);
  const essay = (
    await essays.attach(
      owner,
      task.id,
      command({ groups: [{ studentName: "", uploadIds: [uploadId] }] }),
    )
  ).items[0];
  return { task, essay, uploadId, essays };
}
export async function resultFor(essayId: string, task: ConfirmedTaskPackageV2) {
  return executeMultimodalOperation(
    {
      gradeEssay: async () => ({
        value: {
          transcript: "I have a pen.",
          recognitionWarnings: [],
          printedTextExcluded: true,
          reportedTotalScore: 15,
          dimensionScores: task.rubric.dimensions.map((d) => ({
            dimensionId: d.id,
            score: (task.fullScore * d.weight) / 100,
            reason: "Complete",
            evidence: "I have a pen.",
            relatedIssueKeys: [],
          })),
          issues: [],
          sentenceRevisions: [],
          expressionUpgrades: [],
          fullTextRevision: {
            sentencePairs: [],
            logicNotes: [],
            logicIssues: [],
          },
          legibilityIssues: [],
          overallComment: "Clear.",
        },
        attempts: [],
      }),
      generateRubric: async () => {
        throw Error("unexpected");
      },
      generateMaterialContext: async () => {
        throw Error("unexpected");
      },
    },
    {
      kind: "grade",
      input: {
        requestId: randomUUID(),
        essayId,
        task,
        pages: [
          {
            pageId: randomUUID(),
            mimeType: "image/png",
            buffer: Buffer.from("synthetic"),
          },
        ],
        signal: new AbortController().signal,
      },
    },
    {},
  );
}
