import { QueueClient, send } from "@vercel/queue";
import { id, record, integer } from "./validation.js";
import { PilotError } from "./errors.js";
import { runPilotJob, type WorkerDeps } from "./worker.js";
export interface JobQueue {
  publish(
    jobId: string,
    deliveryKey: string,
    delaySeconds?: number,
  ): Promise<void>;
}
export function parseQueueMessage(value: unknown): { jobId: string } {
  const v = record(value, ["jobId"]);
  return { jobId: id(v.jobId) };
}
export function createJobQueue(sender: typeof send = send): JobQueue {
  return {
    async publish(jobId, key, delay = 0) {
      id(jobId);
      integer(delay, 0, 86399);
      if (!new RegExp("^" + jobId + ":[1-9][0-9]*$").test(key))
        throw new PilotError("invalid_delivery_key");
      await sender(
        "writewise-pilot",
        { jobId },
        {
          region: "sin1",
          retentionSeconds: 86400,
          idempotencyKey: key,
          delaySeconds: delay,
        },
      );
    },
  };
}
export function createWorkerHandler(load: () => Promise<WorkerDeps>) {
  const queue = new QueueClient({ region: "sin1" });
  const callback = queue.handleNodeCallback(
    async (message, metadata) => {
      if (
        metadata.topicName !== "writewise-pilot" ||
        metadata.region !== "sin1"
      )
        throw new PilotError("invalid_queue_delivery");
      const { jobId } = parseQueueMessage(message);
      try {
        if ((await runPilotJob(jobId, await load())) === "deferred")
          throw new PilotError("queue_deferred", 503);
      } catch {
        throw new PilotError("queue_deferred", 503);
      }
    },
    {
      visibilityTimeoutSeconds: 300,
      retry: (_error, metadata) => ({
        afterSeconds: Math.min(300, Math.max(5, metadata.deliveryCount * 5)),
      }),
    },
  );
  return (
    req: Parameters<typeof callback>[0],
    res: Parameters<typeof callback>[1],
  ) => {
    // Vercel's private trigger is the access boundary; reject ordinary HTTP before SDK parsing/logging.
    if (
      req.method !== "POST" ||
      req.headers["ce-type"] !== "com.vercel.queue.v2beta"
    ) {
      res.status(404).end();
      return Promise.resolve();
    }
    return callback(req, res);
  };
}
