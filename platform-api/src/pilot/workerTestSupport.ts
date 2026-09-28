import { createHash } from "node:crypto";
import type { Database } from "../database.js";
import type { PrivateStorage } from "./storage.js";
import type { JobQueue } from "./queue.js";
import type { MultimodalProvider } from "../../../grading-gateway/src/providers/multimodalProviderTypes.js";
import { PilotUploadService } from "./uploads.js";
import { PilotJobRepository } from "./jobs.js";
import { command, ownerA } from "./testSupport.js";
import { seedEssay } from "./jobTestSupport.js";
export class MemoryStorage implements PrivateStorage {
  objects = new Map<string, Uint8Array>();
  removed: string[] = [];
  reads = 0;
  async signUpload(path: string) {
    return {
      url: "https://synthetic.test/" + path,
      expiresAt: new Date(Date.now() + 7200000).toISOString(),
    };
  }
  async signRead(path: string) {
    return "https://synthetic.test/" + path;
  }
  async read(path: string) {
    this.reads++;
    const bytes = this.objects.get(path);
    if (!bytes) throw Error("missing synthetic object");
    return { bytes, contentType: "image/png" };
  }
  async remove(paths: string[]) {
    for (const path of paths) {
      this.objects.delete(path);
      this.removed.push(path);
    }
  }
}
export class MemoryQueue implements JobQueue {
  messages: { jobId: string; key: string; delay: number }[] = [];
  fail = false;
  async publish(jobId: string, key: string, delay = 0) {
    if (this.fail) throw Error("synthetic publish failure");
    this.messages.push({ jobId, key, delay });
  }
}
export async function workerFixture(
  db: Database,
  store = new MemoryStorage(),
  owner = ownerA,
) {
  const s = await seedEssay(db, owner),
    bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
  await db.query(
    "UPDATE pilot_grading.uploads SET size=$2,sha256=$3 WHERE id=$1",
    [
      s.uploadId,
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
    ],
  );
  const path = String(
    (
      await db.query("SELECT path FROM pilot_grading.uploads WHERE id=$1", [
        s.uploadId,
      ])
    ).rows[0].path,
  );
  store.objects.set(path, bytes);
  const jobs = new PilotJobRepository(db);
  await jobs.enqueueTask(owner, s.task.id, command({}));
  const job = (await s.essays.get(owner, s.essay.id)).currentJob!;
  let calls = 0;
  const provider: MultimodalProvider = {
    generateMaterialContext: async () => {
      throw Error("unexpected");
    },
    generateRubric: async () => {
      throw Error("unexpected");
    },
    gradeEssay: async (input) => {
      calls++;
      return {
        value: {
          transcript: input.confirmedTranscript ?? "I have a pen.",
          recognitionWarnings: [],
          printedTextExcluded: true,
          reportedTotalScore: 15,
          dimensionScores: input.task.rubric.dimensions.map((d) => ({
            dimensionId: d.id,
            score: (input.task.fullScore * d.weight) / 100,
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
      };
    },
  };
  const queue = new MemoryQueue();
  return {
    ...s,
    job,
    jobs,
    path,
    store,
    queue,
    provider,
    calls: () => calls,
    deps: {
      db,
      queue,
      storage: store,
      uploads: new PilotUploadService(db, store),
      provider,
    },
  };
}
