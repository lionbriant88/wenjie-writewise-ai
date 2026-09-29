import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  assertDiskReady,
  assertWorkerReady,
  writeWorkerHeartbeat,
} from "./readiness.js";
it("fails readiness for missing, expired, dead or malformed worker heartbeat", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wj-heartbeat-")),
    file = join(dir, "worker.json");
  try {
    await expect(assertWorkerReady(file)).rejects.toThrow();
    await writeWorkerHeartbeat(file);
    await expect(assertWorkerReady(file)).resolves.toBeUndefined();
    await writeFile(
      file,
      JSON.stringify({ pid: process.pid, at: Date.now() - 120000 }),
    );
    await expect(assertWorkerReady(file)).rejects.toThrow();
    await writeFile(file, JSON.stringify({ pid: 999999999, at: Date.now() }));
    await expect(assertWorkerReady(file)).rejects.toThrow();
    await writeFile(file, "not JSON");
    await expect(assertWorkerReady(file)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("storage readiness is read-only and requires existing private storage directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wj-readiness-"));
  try {
    await expect(assertDiskReady(join(dir, "missing"))).rejects.toThrow();
    await mkdir(join(dir, "originals"));
    await expect(
      assertDiskReady(join(dir, "originals"), async () => 11 * 1024 ** 3),
    ).resolves.toBeUndefined();
    await expect(
      assertDiskReady(join(dir, "originals"), async () => 9 * 1024 ** 3),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
