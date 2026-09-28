import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import {
  parseQueueMessage,
  createJobQueue,
  createWorkerHandler,
} from "./queue.js";
import { createMaintenanceHandler } from "./maintenanceHandler.js";
const job = "00000000-0000-4000-8000-000000000001";
it("queuePayloadOnlyContainsOpaqueJobId", async () => {
  expect(parseQueueMessage({ jobId: job })).toEqual({ jobId: job });
  for (const value of [
    { jobId: job, ownerId: job },
    { jobId: job, prompt: "private" },
    { jobId: "invalid" },
  ])
    expect(() => parseQueueMessage(value)).toThrow();
  const sent: unknown[] = [];
  const queue = createJobQueue(async (...args) => {
    sent.push(args);
    return { messageId: "synthetic" };
  });
  await queue.publish(job, job + ":1", 5);
  expect(sent).toEqual([
    [
      "writewise-pilot",
      { jobId: job },
      {
        region: "sin1",
        retentionSeconds: 86400,
        idempotencyKey: job + ":1",
        delaySeconds: 5,
      },
    ],
  ]);
});
it("anonymousWorkerAndMaintenanceCannotInitializeRuntime", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    throw Error("must not initialize");
  };
  const worker = express().all("/worker", createWorkerHandler(load));
  const response = await request(worker).post("/worker").send({ jobId: job });
  expect(response.status).toBeGreaterThanOrEqual(400);
  const maintenance = express().all(
    "/maintenance",
    createMaintenanceHandler(load, () => "synthetic-secret-long-enough"),
  );
  expect((await request(maintenance).get("/maintenance")).status).toBe(401);
  expect(
    (
      await request(maintenance)
        .get("/maintenance")
        .set("Authorization", "Bearer wrong")
    ).status,
  ).toBe(401);
  expect(calls).toBe(0);
});
it("privateWorkerAndDailyMaintenanceEscapeApiCatchAll", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../../vercel.json", import.meta.url), "utf8"),
  );
  expect(config.functions["api/pilot-worker.ts"]).toMatchObject({
    maxDuration: 300,
    experimentalTriggers: [{ type: "queue/v2beta", topic: "writewise-pilot" }],
  });
  expect(config.crons).toEqual([
    { path: "/api/pilot-maintenance", schedule: "0 0 * * *" },
  ]);
  const catchAll = config.rewrites.find(
    (r: { destination: string; source: string }) =>
      r.destination === "/api/index" && r.source !== "/api",
  );
  expect(catchAll.source).toContain("pilot-worker");
  expect(catchAll.source).toContain("pilot-maintenance");
});
