import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { PilotRuntime } from "../pilot/runtime.js";
import { runPilotJob } from "../pilot/worker.js";
import { openStandaloneRuntime } from "../runtime.js";
import { writeWorkerHeartbeat } from "./readiness.js";

export function createStandaloneWorker(
  runtime: PilotRuntime,
  runJob: typeof runPilotJob = runPilotJob,
) {
  const queue = runtime.postgresQueue,
    gate = runtime.migrationGate;
  if (!queue || !gate) throw Error("standalone_worker_incomplete");
  let stopping = false,
    active: Promise<boolean> | undefined;
  const tick = (): Promise<boolean> => {
    if (stopping || active) return Promise.resolve(false);
    active = gate
      .run(async () => {
        if (stopping) return false;
        const lease = await queue.lease();
        if (!lease) return false;
        let done = false;
        try {
          done = (await runJob(lease.jobId, runtime)) === "done";
        } catch {
          /* Same durable identity only. */
        }
        if (done) await queue.acknowledge(lease);
        else await queue.defer(lease, 30);
        return true;
      })
      .finally(() => {
        active = undefined;
      });
    return active;
  };
  return {
    tick,
    async stop() {
      stopping = true;
      await active;
    },
  };
}
async function main() {
  // Operator-controlled marker prevents an installed/restored worker from
  // consuming copied jobs merely because systemd starts the service.
  if (process.env.PILOT_WORKER_ENABLED !== "1")
    throw Error("worker_not_enabled");
  const runtime = await openStandaloneRuntime(process.env);
  const heartbeat = process.env.PILOT_WORKER_HEARTBEAT_FILE!;
  const worker = createStandaloneWorker(runtime.pilotRuntime);
  let stopping = false;
  const wake = new AbortController();
  const stop = () => {
    stopping = true;
    wake.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let heartbeatTail: Promise<void> = Promise.resolve();
  const beat = () => {
    heartbeatTail = heartbeatTail.then(() => writeWorkerHeartbeat(heartbeat));
    void heartbeatTail.catch(stop);
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await writeWorkerHeartbeat(heartbeat);
    timer = setInterval(beat, 15000);
    while (!stopping) {
      try {
        if (await worker.tick()) continue;
      } catch {
        /* Frozen/unavailable: bounded polling, no provider replay. */
      }
      await delay(1000, undefined, { signal: wake.signal }).catch(() => {});
    }
  } finally {
    if (timer) clearInterval(timer);
    await worker.stop().catch(() => {});
    await heartbeatTail.catch(() => {});
    await unlink(heartbeat).catch(() => {});
    await runtime.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error("standalone_worker_failed");
    process.exitCode = 1;
  });
