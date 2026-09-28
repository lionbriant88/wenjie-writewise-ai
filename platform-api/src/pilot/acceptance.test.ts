import { expect, it } from "vitest";
import { verifyPilotLocal } from "../../scripts/verifyPilotLocal.js";

it("persists the authenticated two-teacher synthetic flow through duplicates, background work, review, relogin and deletion", async () => {
  const report = await verifyPilotLocal();
  expect(report).toMatchObject({
    passed: true,
    modelCalls: 3,
    ownershipDenied: true,
    reviewConflict: true,
    cleanupComplete: true,
  });
  expect(report.imageCounts.slice(0, 2).sort()).toEqual([1, 2]);
  expect(report.imageCounts[2]).toBe(0);
}, 30000);
