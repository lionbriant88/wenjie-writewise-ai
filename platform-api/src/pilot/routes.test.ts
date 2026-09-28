import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../server.js";
import { httpFixture } from "./httpTestSupport.js";
import { workerFixture } from "./workerTestSupport.js";
import { command, ownerA, validDraft } from "./testSupport.js";
let fixture: Awaited<ReturnType<typeof httpFixture>>,
  sample: Awaited<ReturnType<typeof workerFixture>>,
  app: ReturnType<typeof createApp>;
beforeAll(async () => {
  fixture = await httpFixture();
  sample = await workerFixture(fixture.db);
  app = createApp(fixture.repo, fixture.config, undefined, {
    pilotRuntime: sample.deps,
  });
});
afterAll(async () => {
  await fixture?.db.close();
});
function call(
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  who = 0,
  body?: unknown,
) {
  const s = fixture.sessions[who],
    r = request(app)
      [method]("/api/pilot" + path)
      .set("Cookie", s.cookie);
  if (method !== "get")
    r.set("Origin", fixture.config.origin).set("X-CSRF-Token", s.csrf);
  return body === undefined ? r : r.send(body as object);
}
it("allOwnedResourceRoutesHideOtherTeachersAndDenyAdministrator", async () => {
  const t = sample.task.id,
    e = sample.essay.id,
    u = sample.uploadId,
    j = sample.job.id;
  const routes: [Parameters<typeof call>[0], string, unknown?][] = [
    ["get", "/tasks/" + t],
    ["patch", "/tasks/" + t, command(validDraft(), 2)],
    ["delete", "/tasks/" + t, command({}, 2)],
    ["post", `/tasks/${t}/confirm`, command({}, 2)],
    ["get", `/tasks/${t}/uploads`],
    [
      "post",
      `/tasks/${t}/uploads`,
      command({
        purpose: "essay",
        mimeType: "image/png",
        size: 20,
        label: "Synthetic",
      }),
    ],
    ["post", `/uploads/${u}/complete`, command({})],
    ["get", `/uploads/${u}/read-url`],
    ["get", `/tasks/${t}/essays`],
    [
      "post",
      `/tasks/${t}/essays`,
      command({ groups: [{ studentName: "", uploadIds: [u] }] }),
    ],
    ["get", `/essays/${e}`],
    [
      "patch",
      `/essays/${e}/transcript`,
      command({ text: "Synthetic correction." }, 1),
    ],
    [
      "put",
      `/essays/${e}/review`,
      command(
        {
          dimensionScores: [],
          overallComment: "",
          teacherSuggestion: "",
          confirm: false,
        },
        1,
      ),
    ],
    ["put", `/essays/${e}/manual`, command({ manualReviewRequired: true }, 1)],
    ["post", `/tasks/${t}/grade`, command({})],
    ["post", `/tasks/${t}/assist`, command({ kind: "rubric" }, 2)],
    ["get", `/jobs/${j}`],
    ["post", `/jobs/${j}/retry`, command({}, 1)],
  ];
  for (const [method, path, body] of routes) {
    const foreign = await call(method, path, 1, body);
    expect(foreign.status, path).toBe(404);
    expect(foreign.body.error.code, path).toBe("not_found");
    expect((await call(method, path, 2, body)).status, path).toBe(403);
  }
  expect((await call("get", "/tasks", 1)).body.items).toEqual([]);
  expect((await call("get", "/capabilities", 2)).status).toBe(403);
});
it("supportsOwnedTaskSaveConfirmUploadAndJobReads", async () => {
  const draft = await call("post", "/tasks", 0, command(validDraft()));
  expect(draft.status).toBe(201);
  expect(draft.body.id).toBeTruthy();
  const save = await call(
    "patch",
    "/tasks/" + draft.body.id,
    0,
    command({ ...validDraft(), taskName: "Cloud saved" }, draft.body.revision),
  );
  expect(save.status).toBe(200);
  const confirmed = await call(
    "post",
    `/tasks/${draft.body.id}/confirm`,
    0,
    command({}, save.body.revision),
  );
  expect(confirmed.body.state).toBe("confirmed");
  expect(
    (await call("get", "/tasks/" + draft.body.id)).body.draft.taskName,
  ).toBe("Cloud saved");
  expect(
    (await call("get", `/uploads/${sample.uploadId}/read-url`)).body.url,
  ).toContain("https://synthetic.test/");
  expect((await call("get", "/jobs/" + sample.job.id)).body.id).toBe(
    sample.job.id,
  );
  expect((await call("get", "/capabilities")).body).toMatchObject({
    teacherMvp: true,
    aiAvailable: true,
    queueState: "ready",
  });
});
it("requiresSessionOriginAndCsrfBeforeBusinessMutation", async () => {
  expect((await request(app).get("/api/pilot/tasks")).status).toBe(401);
  const s = fixture.sessions[0];
  for (const origin of [undefined, "https://evil.example"]) {
    let r = request(app)
      .post("/api/pilot/tasks")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf);
    if (origin) r = r.set("Origin", origin);
    expect((await r.send(command(validDraft()))).status).toBe(403);
  }
  expect(
    (
      await request(app)
        .post("/api/pilot/tasks")
        .set("Cookie", s.cookie)
        .set("Origin", fixture.config.origin)
        .send(command(validDraft()))
    ).status,
  ).toBe(403);
});
it("rejectsClientOwnerStatusCountsResultsUnknownFieldsAndOversizedJson", async () => {
  for (const extra of [
    { ownerId: ownerA },
    { status: "completed" },
    { counts: { total: 999 } },
    { result: { totalScore: 15 } },
  ])
    expect(
      (await call("post", "/tasks", 0, command({ ...validDraft(), ...extra })))
        .status,
    ).toBe(400);
  expect(
    (
      await call(
        "post",
        "/tasks",
        0,
        command({ ...validDraft(), taskName: "x".repeat(2100000) }),
      )
    ).status,
  ).toBe(413);
  const textDraft = {
    ...validDraft(),
    materialRefs: [
      {
        kind: "text",
        id: "00000000-0000-4000-8000-000000000010",
        displayName: "Synthetic.docx",
        text: "x".repeat(20000),
        warnings: ["docx_body_only"],
      },
    ],
  };
  expect((await call("post", "/tasks", 0, command(textDraft))).status).toBe(
    201,
  );
});
it("disabledMvpLeavesAccountSessionUsableAndNeverReopensRawGateway", async () => {
  const closed = createApp(fixture.repo, fixture.config),
    s = fixture.sessions[0];
  expect(
    (await request(closed).get("/api/auth/session").set("Cookie", s.cookie))
      .status,
  ).toBe(200);
  expect(
    (
      await request(closed)
        .get("/api/pilot/capabilities")
        .set("Cookie", s.cookie)
    ).body.teacherMvp,
  ).toBe(false);
  expect(
    (await request(closed).get("/api/pilot/tasks").set("Cookie", s.cookie))
      .status,
  ).toBe(503);
  for (const path of [
    "/api/grading/grade-images",
    "/api/tasks/rubric",
    "/api/tasks/material-context",
  ]) {
    expect(
      (await request(closed).post(path).set("Origin", fixture.config.origin))
        .status,
    ).toBe(401);
    const res = await request(closed)
      .post(path)
      .set("Cookie", s.cookie)
      .set("Origin", fixture.config.origin);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("persistent_job_required");
  }
});
