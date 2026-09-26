import request from "supertest";
import express from "express";
import { expect, it } from "vitest";
import { createVercelGradingApp } from "./grading.js";

it("selects DeepSeek explicitly and never falls back to an OpenRouter credential", async () => {
  expect(createVercelGradingApp({ GRADING_PROVIDER: "deepseek", OPENROUTER_API_KEY: "synthetic-router" }, "https://school.example")).toBeUndefined();
  const app = createVercelGradingApp({ GRADING_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "synthetic-direct", OPENROUTER_API_KEY: "synthetic-router" }, "https://school.example");
  const health = await request(express().use(app!)).get("/health");
  expect(health.body.runtime).toMatchObject({ provider: "deepseek", model: "deepseek-flash", hardLimit: 1 });
  expect(JSON.stringify(health.body)).not.toMatch(/synthetic-direct|synthetic-router/);
});

it("does not mount grading when the server-side OpenRouter key is absent", () => {
  expect(createVercelGradingApp({}, "https://school.example")).toBeUndefined();
});

it("requires an explicit provider even when an old router credential remains configured", () => {
  expect(createVercelGradingApp({ OPENROUTER_API_KEY: "synthetic-router", DEEPSEEK_API_KEY: "synthetic-direct" }, "https://school.example")).toBeUndefined();
});

it("builds the protected-ready Gateway with the configured free model without exposing the key", async () => {
  const app = createVercelGradingApp({
    GRADING_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "synthetic-server-key",
    OPENROUTER_MODEL: "dots-studio/dots-3-note-preview:free",
  }, "https://school.example");
  expect(app).toBeDefined();
  const health = await request(express().use(app!)).get("/health");
  expect(health.status).toBe(200);
  expect(health.body.runtime.provider).toBe("openrouter");
  expect(health.body.runtime.model).toBe("dots-studio/dots-3-note-preview:free");
  expect(JSON.stringify(health.body)).not.toContain("synthetic-server-key");
});
