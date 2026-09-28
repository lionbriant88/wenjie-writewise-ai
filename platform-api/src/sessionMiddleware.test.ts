import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import { httpFixture } from "./pilot/httpTestSupport.js";
import { createSessionTools } from "./sessionMiddleware.js";
it("projectsOnlyPublicTeacherIdentityAndRejectsRevokedSession", async () => {
  const s = await httpFixture();
  try {
    const app = express(),
      guards = createSessionTools(s.repo, s.config);
    app.get("/", guards.requireSession({ teacher: true }), (_req, res) =>
      res.json(res.locals.user),
    );
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.status((error as { status: number }).status).end(),
    );
    const response = await request(app)
      .get("/")
      .set("Cookie", s.sessions[0].cookie);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(s.sessions[0].owner);
    expect(response.text).not.toContain("synthetic-hash");
    expect(
      (await request(app).get("/").set("Cookie", s.sessions[2].cookie)).status,
    ).toBe(403);
    await s.db.query("DELETE FROM pilot_auth.sessions");
    expect(
      (await request(app).get("/").set("Cookie", s.sessions[0].cookie)).status,
    ).toBe(401);
  } finally {
    await s.db.close();
  }
});
