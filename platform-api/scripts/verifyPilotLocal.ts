import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import request from "supertest";
import { createLocalDatabase } from "../src/localDatabase.js";
import { migrate } from "../src/migrate.js";
import { migratePilot } from "../src/pilot/migrate.js";
import { hashPassword } from "../src/crypto.js";
import { AuthRepository } from "../src/repository.js";
import { createApp } from "../src/server.js";
import { MemoryStorage, MemoryQueue } from "../src/pilot/workerTestSupport.js";
import { PilotUploadService } from "../src/pilot/uploads.js";
import { PilotCleanupService } from "../src/pilot/cleanup.js";
import { runPilotJob } from "../src/pilot/worker.js";
import { validDraft, command } from "../src/pilot/testSupport.js";
import type { AuthConfig } from "../src/config.js";
import type { MultimodalProvider } from "../../grading-gateway/src/providers/multimodalProviderTypes.js";
import type {
  EssayDto,
  TaskDto,
  UploadTicket,
} from "../../shared/pilotContracts.js";

export const syntheticImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
export function syntheticProvider(imageCounts: number[]): MultimodalProvider {
  return {
    generateMaterialContext: async () => ({
      value: {
        materialSummary: "Synthetic task material.",
        writingRequirements: ["Write a short story."],
        constraints: [],
        reviewWarnings: [],
      },
      attempts: [],
    }),
    generateRubric: async () => ({
      value: {
        taskName: "Synthetic",
        materialSummary: "Synthetic task material.",
        writingRequirements: ["Write a short story."],
        constraints: [],
        reviewWarnings: [],
        dimensions: validDraft().dimensions,
      },
      attempts: [],
    }),
    gradeEssay: async (input) => {
      imageCounts.push(input.pages.length);
      return {
        value: {
          transcript: input.confirmedTranscript ?? "I have a pen.",
          recognitionWarnings: [],
          printedTextExcluded: true,
          reportedTotalScore: input.task.fullScore,
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
}
export async function verifyPilotLocal() {
  const db = createLocalDatabase(),
    storage = new MemoryStorage(),
    queue = new MemoryQueue(),
    imageCounts: number[] = [];
  try {
    await migrate(db);
    const password = randomBytes(24).toString("hex"),
      passwordHash = await hashPassword(password);
    await db.query(
      "INSERT INTO pilot_auth.batches(id,digest) VALUES('teacher-pilot-v1',$1)",
      ["0".repeat(64)],
    );
    const accounts = [0, 1].map(() => ({
      id: randomUUID(),
      username: "wj_" + randomBytes(12).toString("hex"),
    }));
    for (const account of accounts)
      await db.query(
        "INSERT INTO pilot_auth.accounts(id,batch_id,username,display_name,role,password_hash) VALUES($1,'teacher-pilot-v1',$2,'Synthetic teacher','teacher',$3)",
        [account.id, account.username, passwordHash],
      );
    await migratePilot(db);
    const config: AuthConfig = {
      origin: "https://school.example",
      secret: randomBytes(32).toString("hex"),
      secure: true,
      cookieName: "__Host-wj_session",
      trustedVercel: false,
      storage: "local",
    };
    const runtime = {
      db,
      storage,
      queue,
      uploads: new PilotUploadService(db, storage),
      provider: syntheticProvider(imageCounts),
    };
    const app = createApp(new AuthRepository(db), config, undefined, {
      pilotRuntime: runtime,
    });
    async function login(index: number) {
      const response = await request(app)
        .post("/api/auth/login")
        .set("Origin", config.origin)
        .send({ username: accounts[index].username, password });
      assert.equal(response.status, 200, "synthetic_login");
      return {
        cookie: response.headers["set-cookie"][0].split(";")[0],
        csrf: response.body.csrfToken as string,
      };
    }
    let a = await login(0);
    const b = await login(1);
    const call = (
      method: "get" | "post" | "patch" | "put" | "delete",
      path: string,
      body?: unknown,
      who = a,
    ) => {
      const op = request(app)
        [method]("/api" + path)
        .set("Cookie", who.cookie);
      if (method !== "get")
        op.set("Origin", config.origin).set("X-CSRF-Token", who.csrf);
      return body === undefined ? op : op.send(body as object);
    };
    const created = await call("post", "/pilot/tasks", command(validDraft()));
    assert.equal(created.status, 201);
    const draft = created.body as TaskDto;
    const confirmed = await call(
      "post",
      `/pilot/tasks/${draft.id}/confirm`,
      command({}, draft.revision),
    );
    assert.equal(confirmed.status, 200);
    const task = confirmed.body as TaskDto;
    const uploadIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const reservation = command({
        purpose: "essay",
        mimeType: "image/png",
        size: syntheticImage.length,
        label: "Synthetic page " + (i + 1),
      });
      const reserved = await call(
        "post",
        `/pilot/tasks/${task.id}/uploads`,
        reservation,
      );
      assert.equal(reserved.status, 201);
      const ticket = reserved.body as UploadTicket;
      assert.equal(
        (await call("post", `/pilot/tasks/${task.id}/uploads`, reservation))
          .body.uploadId,
        ticket.uploadId,
        "lost_reserve_ack",
      );
      const path = String(
        (
          await db.query("SELECT path FROM pilot_grading.uploads WHERE id=$1", [
            ticket.uploadId,
          ])
        ).rows[0].path,
      );
      storage.objects.set(path, new Uint8Array(syntheticImage));
      const reads = storage.reads;
      assert.equal(
        (
          await call(
            "post",
            `/pilot/uploads/${ticket.uploadId}/complete`,
            command({}),
            b,
          )
        ).status,
        404,
      );
      assert.equal(
        storage.reads,
        reads,
        "foreign_upload_must_not_read_storage",
      );
      const completion = command({});
      assert.equal(
        (
          await call(
            "post",
            `/pilot/uploads/${ticket.uploadId}/complete`,
            completion,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "post",
            `/pilot/uploads/${ticket.uploadId}/complete`,
            completion,
          )
        ).status,
        200,
        "lost_complete_ack",
      );
      assert.equal(
        (
          await call(
            "get",
            `/pilot/uploads/${ticket.uploadId}/read-url`,
            undefined,
            b,
          )
        ).status,
        404,
      );
      uploadIds.push(ticket.uploadId);
    }
    const attached = await call(
      "post",
      `/pilot/tasks/${task.id}/essays`,
      command({
        groups: [
          { studentName: "", uploadIds: uploadIds.slice(0, 2) },
          { studentName: "", uploadIds: uploadIds.slice(2) },
        ],
      }),
    );
    assert.equal(attached.status, 201);
    const essays = attached.body.items as EssayDto[];
    assert.equal(essays.length, 2);
    assert.deepEqual(
      essays[0].pages.map((p) => p.uploadId),
      uploadIds.slice(0, 2),
    );
    queue.fail = true;
    assert.equal(
      (await call("post", `/pilot/tasks/${task.id}/grade`, command({}))).body
        .accepted,
      2,
      "durable_even_if_publish_fails",
    );
    queue.fail = false;
    assert.equal(
      (await call("post", `/pilot/tasks/${task.id}/grade`, command({}))).body
        .accepted,
      0,
      "double_enqueue",
    );
    const pending = (await call("get", `/pilot/tasks/${task.id}/essays`)).body
      .items as EssayDto[];
    assert.equal((await call("post", "/auth/logout")).status, 204);
    assert.equal((await call("get", "/auth/session")).status, 401);
    const jobs = pending.map((e) => e.currentJob!.id);
    const outcomes = await Promise.all(
      jobs.map((id) => runPilotJob(id, runtime)),
    );
    for (let i = 0; i < jobs.length; i++)
      if (outcomes[i] === "deferred") await runPilotJob(jobs[i], runtime);
    for (const id of jobs) await runPilotJob(id, runtime); // lost queue ACK redelivery
    assert.deepEqual([...imageCounts].sort(), [1, 2]);
    a = await login(0);
    const saved = (await call("get", `/pilot/tasks/${task.id}/essays`)).body
      .items as EssayDto[];
    assert.ok(
      saved.every(
        (e) => e.currentResult?.ai.resultVersion === "grading-result-v2",
      ),
    );
    assert.equal(
      (await call("get", `/pilot/essays/${saved[0].id}`, undefined, b)).status,
      404,
    );
    const review = {
      dimensionScores: task.confirmedPackage!.rubric.dimensions.map((d) => ({
        dimensionId: d.id,
        score: (task.confirmedPackage!.fullScore * d.weight) / 100,
      })),
      overallComment: "Teacher saved comment.",
      teacherSuggestion: "Keep practising.",
      confirm: true,
    };
    const reviewed = await call(
      "put",
      `/pilot/essays/${saved[0].id}/review`,
      command(review, saved[0].revision),
    );
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.teacherReviewed, true);
    assert.equal(
      (
        await call(
          "put",
          `/pilot/essays/${saved[0].id}/review`,
          command(
            { ...review, overallComment: "Stale edit" },
            saved[0].revision,
          ),
        )
      ).status,
      409,
    );
    const transcript = await call(
      "patch",
      `/pilot/essays/${saved[0].id}/transcript`,
      command({ text: "I have two pens." }, reviewed.body.revision),
    );
    assert.equal(transcript.status, 200);
    assert.equal(transcript.body.currentResult, null);
    assert.equal(
      (await call("post", `/pilot/tasks/${task.id}/grade`, command({}))).body
        .accepted,
      1,
    );
    const again = (await call("get", `/pilot/essays/${saved[0].id}`))
      .body as EssayDto;
    const reads = storage.reads;
    await runPilotJob(again.currentJob!.id, runtime);
    assert.equal(storage.reads, reads, "confirmed_text_zero_images");
    assert.equal(imageCounts.length, 3);
    assert.equal(imageCounts.at(-1), 0);
    assert.equal(
      (await call("get", `/pilot/essays/${saved[0].id}`)).body.currentResult.ai
        .transcript,
      "I have two pens.",
    );
    const removed = await call(
      "delete",
      `/pilot/tasks/${task.id}`,
      command({}, task.revision),
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { deleted: true });
    assert.equal((await call("get", `/pilot/tasks/${task.id}`)).status, 404);
    await db.query(
      "UPDATE pilot_grading.uploads SET last_signed_at=now()-interval '3 hours' WHERE task_id=$1",
      [task.id],
    );
    await new PilotCleanupService(db, storage).runBatch(50);
    assert.equal(storage.objects.size, 0);
    assert.equal(
      (await db.query("SELECT job_id FROM pilot_grading.grading_results")).rows
        .length,
      0,
    );
    assert.equal((await call("post", "/auth/logout")).status, 204);
    assert.equal(
      (await call("post", "/auth/logout", undefined, b)).status,
      204,
    );
    assert.equal(
      (await db.query("SELECT token_hash FROM pilot_auth.sessions")).rows
        .length,
      0,
    );
    return {
      passed: true,
      modelCalls: imageCounts.length,
      imageCounts,
      ownershipDenied: true,
      reviewConflict: true,
      cleanupComplete: true,
    };
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  verifyPilotLocal()
    .then((report) => console.log(JSON.stringify(report)))
    .catch(() => {
      console.error("pilot_local_verification_failed");
      process.exitCode = 1;
    });
}
