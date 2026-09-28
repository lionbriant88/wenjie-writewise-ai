import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  EssayDto,
  JobDto,
  TaskDto,
  TaskDraftInput,
} from "../../shared/pilotContracts.js";
import { validDraft, command } from "../src/pilot/testSupport.js";
import {
  fixturePngPath,
  verifyCanonicalPolicyFixture,
} from "../../grading-gateway/scripts/verifyPolicyGoldenFixtures.js";

type Case = "single" | "multi" | "rubric";
export function finalizePublicReport(report: Record<string, unknown>) {
  if (
    report.passed === true &&
    (report.testTaskDeleted !== true || report.sessionsClosed !== true)
  ) {
    report.passed = false;
    report.state = "cleanup_incomplete";
    throw Error("pilot_public_cleanup_incomplete");
  }
  return report;
}
const origin = "https://wenjie-writewise-pilot.vercel.app";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ledger = join(
  root,
  "grading-gateway/local-private-results/teacher-cloud-mvp",
);
export async function reservePublicCase(folder: string, name: Case) {
  if (!["single", "multi", "rubric"].includes(name))
    throw Error("invalid_case");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, name + "-reservation.json"),
    JSON.stringify(
      {
        case: name,
        state: "reserved",
        maximumLogicalJobs: 1,
        syntheticOnly: true,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
}
type Session = { cookie: string; csrf: string };
async function http(
  path: string,
  method = "GET",
  body?: unknown,
  session?: Session,
) {
  const response = await fetch(origin + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Origin: origin,
      ...(session
        ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, data, response };
}
export async function verifyPilotPublic(name: Case, inspectOnly = false) {
  const credentialPath = join(
    root,
    "local-private-accounts/pilot-batch/teachers.tsv",
  );
  execFileSync("git", ["check-ignore", "--quiet", credentialPath], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync(
    "git",
    ["check-ignore", "--quiet", ledger + "/single-reservation.json"],
    { cwd: root, stdio: "ignore" },
  );
  const credentials = (await readFile(credentialPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .slice(1, 3)
    .map((line) => {
      const [, username, password] = line.split("\t");
      return { username, password };
    });
  assert.equal(credentials.length, 2);
  let a: Session | undefined, b: Session | undefined;
  let report: Record<string, unknown> = {
    case: name,
    startedAt: new Date().toISOString(),
    syntheticOnly: true,
    expectedLogicalJobs: 1,
  };
  let taskId: string | undefined,
    essayId: string | undefined,
    jobId: string | undefined,
    terminal = false;
  let canWriteRecord = false;
  const record = async () => {
    if (canWriteRecord)
      await writeFile(
        join(ledger, name + "-verification.json"),
        JSON.stringify({ ...report, taskId, essayId, jobId }, null, 2),
        { mode: 0o600 },
      );
  };
  async function login(index: number): Promise<Session> {
    const result = await http("/api/auth/login", "POST", credentials[index]);
    assert.equal(result.status, 200, "login");
    const cookie = result.response.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie);
    assert.equal(typeof result.data.csrfToken, "string");
    return { cookie, csrf: result.data.csrfToken };
  }
  async function logout(session: Session) {
    assert.equal(
      (await http("/api/auth/logout", "POST", undefined, session)).status,
      204,
    );
    assert.equal(
      (await http("/api/auth/session", "GET", undefined, session)).status,
      401,
    );
  }
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const result = await http("/api/pilot" + path, method, body, a);
    assert.ok(
      result.status >= 200 && result.status < 300,
      "pilot_" + method + "_" + result.status,
    );
    return result.data as T;
  }
  try {
    // Preflight can be retried after local connection denial; no reservation or model job exists yet.
    assert.equal((await http("/api/pilot/tasks")).status, 401);
    a = await login(0);
    b = await login(1);
    const capabilities = await api<{
      teacherMvp: boolean;
      aiAvailable: boolean;
    }>("/capabilities");
    assert.equal(capabilities.teacherMvp, true);
    assert.equal(capabilities.aiAvailable, true);
    if (inspectOnly) {
      report = JSON.parse(
        await readFile(join(ledger, name + "-verification.json"), "utf8"),
      );
      assert.equal(report.case, name);
      taskId = report.taskId as string;
      essayId = report.essayId as string;
      jobId = report.jobId as string;
      canWriteRecord = true;
      assert.ok(taskId);
      if (!jobId) {
        if (name === "rubric")
          jobId = (await api<JobDto[]>(`/tasks/${taskId}/assist`))[0]?.id;
        else {
          const essay = (
            await api<{ items: EssayDto[] }>(`/tasks/${taskId}/essays`)
          ).items[0];
          essayId = essay?.id;
          jobId = essay?.currentJob?.id;
        }
      }
      assert.ok(jobId, "original_job_not_found_no_retry");
    } else {
      await reservePublicCase(ledger, name);
      canWriteRecord = true;
      await record();
      const worker = await fetch(origin + "/api/pilot-worker", {
        redirect: "manual",
      });
      assert.ok([401, 403, 404, 405].includes(worker.status));
      assert.equal((await http("/api/pilot-maintenance")).status, 401);
      assert.equal(
        (await http("/api/grading/grade-images", "POST", {}, a)).status,
        409,
      );
      const draft: TaskDraftInput = {
        ...validDraft(),
        taskName: "Synthetic MVP " + name,
        writingRequirement:
          "Write a short message inviting a friend to a school club. Assess relevant content and clear English. Printed CASE identifiers are not student writing.",
      };
      if (name === "rubric")
        draft.materialRefs = [
          {
            kind: "text",
            id: randomUUID(),
            displayName: "Synthetic DOCX body",
            text: "Write an invitation to a school club. Explain its activities and suggest a meeting after class. The full score is 15.",
            warnings: ["docx_body_only"],
          },
        ];
      let task = await api<TaskDto>("/tasks", "POST", command(draft));
      taskId = task.id;
      report.state = "prepared";
      await record();
      assert.equal(
        (await http(`/api/pilot/tasks/${taskId}`, "GET", undefined, b)).status,
        404,
      );
      if (name === "rubric") {
        // Persist intent before dispatch so a lost response can only be inspected, never re-enqueued by this script.
        report.state = "dispatching";
        await record();
        const job = await api<JobDto>(
          `/tasks/${taskId}/assist`,
          "POST",
          command({ kind: "rubric" }, task.revision),
        );
        jobId = job.id;
      } else {
        task = await api<TaskDto>(
          `/tasks/${taskId}/confirm`,
          "POST",
          command({}, task.revision),
        );
        const inputs =
          name === "single"
            ? (["grammar-and-logic"] as const)
            : (["grammar-and-logic", "clear-enviroment"] as const);
        const uploadIds: string[] = [];
        for (const fixture of inputs) {
          const bytes = await readFile(fixturePngPath(fixture));
          assert.equal(verifyCanonicalPolicyFixture(fixture, bytes).ok, true);
          const ticket: { uploadId: string; url: string } = await api(
            `/tasks/${taskId}/uploads`,
            "POST",
            command({
              purpose: "essay",
              mimeType: "image/png",
              size: bytes.length,
              label: "Synthetic " + fixture,
            }),
          );
          const destination: URL = new URL(ticket.url);
          assert.equal(
            destination.origin,
            "https://wudbhdyqgnbnuorebhnu.supabase.co",
          );
          assert.ok(
            destination.pathname.startsWith("/storage/v1/object/upload/sign/"),
          );
          const put = await fetch(ticket.url, {
            method: "PUT",
            redirect: "error",
            body: bytes,
            headers: { "Content-Type": "image/png", "x-upsert": "false" },
            signal: AbortSignal.timeout(30000),
          });
          assert.ok(put.ok);
          await api(
            `/uploads/${ticket.uploadId}/complete`,
            "POST",
            command({}),
          );
          assert.equal(
            (
              await http(
                `/api/pilot/uploads/${ticket.uploadId}/read-url`,
                "GET",
                undefined,
                b,
              )
            ).status,
            404,
          );
          const signed = await api<{ url: string }>(
            `/uploads/${ticket.uploadId}/read-url`,
          );
          assert.equal(new URL(signed.url).origin, destination.origin);
          const picture = await fetch(signed.url, {
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          });
          assert.equal(picture.status, 200);
          assert.equal((await picture.arrayBuffer()).byteLength, bytes.length);
          uploadIds.push(ticket.uploadId);
        }
        const attached = await api<{ items: EssayDto[] }>(
          `/tasks/${taskId}/essays`,
          "POST",
          command({
            groups: [{ studentName: "Synthetic student", uploadIds }],
          }),
        );
        essayId = attached.items[0].id;
        report.state = "dispatching";
        await record();
        assert.equal(
          (
            await api<{ accepted: number }>(
              `/tasks/${taskId}/grade`,
              "POST",
              command({}),
            )
          ).accepted,
          1,
        );
        jobId = (await api<EssayDto>(`/essays/${essayId}`)).currentJob!.id;
        assert.equal(
          (
            await api<{ accepted: number }>(
              `/tasks/${taskId}/grade`,
              "POST",
              command({}),
            )
          ).accepted,
          0,
        );
        report.pageCount = uploadIds.length;
      }
      report.state = "dispatched";
      await record();
      await logout(a);
      a = undefined;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      a = await login(0);
      report.reloginPassed = true;
    }
    const start = Date.now();
    let job: JobDto;
    while (true) {
      job = await api<JobDto>(`/jobs/${jobId}`);
      report.jobState = job.state;
      report.waitMs = Date.now() - start;
      if (!["queued", "running"].includes(job.state)) break;
      if (Date.now() - start > 360000)
        throw Error("original_job_still_pending");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    terminal = ["succeeded", "partial", "failed", "cancelled"].includes(
      job.state,
    );
    await record();
    assert.ok(
      job.state === "succeeded" || job.state === "partial",
      "job_did_not_succeed",
    );
    if (name === "rubric") {
      assert.ok(job.result && "dimensions" in job.result);
      const task = await api<TaskDto>(`/tasks/${taskId}`),
        rubric = job.result;
      const changed = await api<TaskDto>(
        `/tasks/${taskId}`,
        "PATCH",
        command(
          {
            ...task.draft,
            source: "ai",
            dimensions: rubric.dimensions,
            materialContext: {
              materialSummary: rubric.materialSummary,
              writingRequirements: rubric.writingRequirements,
              constraints: rubric.constraints,
              reviewWarnings: rubric.reviewWarnings,
            },
            materialProcessingStatus: "ready",
          },
          task.revision,
        ),
      );
      await api(
        `/tasks/${taskId}/confirm`,
        "POST",
        command({}, changed.revision),
      );
      report.rubricConfirmed = true;
    } else {
      const essay = await api<EssayDto>(`/essays/${essayId}`),
        task = await api<TaskDto>(`/tasks/${taskId}`);
      assert.equal(essay.pages.length, name === "single" ? 1 : 2);
      assert.equal(essay.currentResult?.ai.resultVersion, "grading-result-v2");
      assert.ok(
        essay.currentResult?.ai.transcript.includes(
          "I suggest you joins the club.",
        ),
      );
      if (name === "multi")
        assert.ok(
          essay.currentResult.ai.transcript.includes(
            "We should protect the enviroment.",
          ),
        );
      assert.ok(!essay.currentResult.ai.transcript.includes("CASE-A"));
      const review = {
        dimensionScores: essay.currentResult.ai.dimensionScores.map((d) => ({
          dimensionId: d.dimensionId,
          score: d.score,
        })),
        overallComment: "Synthetic teacher confirmation.",
        teacherSuggestion: "Synthetic test only.",
        confirm: true,
      };
      const saved = await api<EssayDto>(
        `/essays/${essayId}/review`,
        "PUT",
        command(review, essay.revision),
      );
      assert.equal(saved.teacherReviewed, true);
      assert.equal(
        (
          await http(
            `/api/pilot/essays/${essayId}/review`,
            "PUT",
            command(review, essay.revision),
            a,
          )
        ).status,
        409,
      );
      assert.equal(
        (await api<EssayDto>(`/essays/${essayId}`)).currentResult?.review
          ?.overallComment,
        review.overallComment,
      );
      assert.equal(
        (await api<TaskDto>(`/tasks/${task.id}`)).counts.completed,
        1,
      );
      report.reviewSaved = true;
      report.resultStatus = essay.currentResult.ai.status;
      report.transcriptMatched = true;
    }
    report.passed = true;
    report.state = "verified";
    await record();
  } catch {
    report.passed = false;
    report.state = "requires_inspection";
    // Keep the reserved logical job even when a network result is unknown.
    await record().catch(() => undefined);
    throw Error("pilot_public_verification_failed");
  } finally {
    if (a && taskId && terminal && report.passed === true) {
      try {
        const task = await api<TaskDto>(`/tasks/${taskId}`);
        await api(`/tasks/${taskId}`, "DELETE", command({}, task.revision));
        report.testTaskDeleted = true;
      } catch {
        report.testTaskDeleted = false;
      }
    }
    let sessionsClosed = true;
    for (const session of [a, b])
      if (session) {
        try {
          await logout(session);
        } catch {
          sessionsClosed = false;
        }
      }
    report.sessionsClosed = sessionsClosed;
    try {
      finalizePublicReport(report);
    } finally {
      await record().catch(() => undefined);
    }
  }
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [, , mode, name] = process.argv;
  if (
    !["--run-authorized-once", "--inspect"].includes(mode) ||
    !["single", "multi", "rubric"].includes(name)
  )
    throw Error("usage_invalid");
  verifyPilotPublic(name as Case, mode === "--inspect")
    .then((report) => console.log(JSON.stringify(report)))
    .catch(() => {
      console.error("pilot_public_verification_failed");
      process.exitCode = 1;
    });
}
