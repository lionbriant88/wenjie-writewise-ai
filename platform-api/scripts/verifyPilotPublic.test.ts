import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  reservePublicCase,
  finalizePublicReport,
} from "./verifyPilotPublic.js";
it("does not certify a verification whose task or sessions failed cleanup", () => {
  for (const incomplete of [
    { testTaskDeleted: false, sessionsClosed: true },
    { testTaskDeleted: true, sessionsClosed: false },
  ]) {
    const report = { passed: true, state: "verified", ...incomplete };
    expect(() => finalizePublicReport(report)).toThrow(
      "pilot_public_cleanup_incomplete",
    );
    expect(report).toMatchObject({
      passed: false,
      state: "cleanup_incomplete",
    });
  }
  expect(
    finalizePublicReport({
      passed: true,
      testTaskDeleted: true,
      sessionsClosed: true,
    }),
  ).toMatchObject({ passed: true });
});
it("atomically refuses a second case reservation even when its result is unknown", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pilot-public-ledger-"));
  try {
    const attempts = await Promise.allSettled([
      reservePublicCase(folder, "single"),
      reservePublicCase(folder, "single"),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(join(folder, "single-reservation.json"), "utf8"),
      ),
    ).toMatchObject({
      case: "single",
      state: "reserved",
      maximumLogicalJobs: 1,
    });
    await expect(reservePublicCase(folder, "single")).rejects.toBeDefined();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
