import request from "supertest";
import { expect, it } from "vitest";
import { createVercelGradingApp } from "./grading.js";

it("does not mount grading when the server-side OpenRouter key is absent", () => {
  expect(createVercelGradingApp({}, "https://school.example")).toBeUndefined();
});

it("builds the protected-ready Gateway with the configured free model without exposing the key", async () => {
  const app = createVercelGradingApp({
    OPENROUTER_API_KEY: "synthetic-server-key",
    OPENROUTER_MODEL: "dots-studio/dots-3-note-preview:free",
  }, "https://school.example");
  expect(app).toBeDefined();
  const health = await request(app!).get("/health");
  expect(health.status).toBe(200);
  expect(health.body.runtime.provider).toBe("openrouter");
  expect(health.body.runtime.model).toBe("dots-studio/dots-3-note-preview:free");
  expect(JSON.stringify(health.body)).not.toContain("synthetic-server-key");
});
