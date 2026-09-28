import { createWorkerHandler } from "../platform-api/src/pilot/queue.js";
import { getPilotRuntime } from "../platform-api/src/pilot/runtime.js";
export default createWorkerHandler(getPilotRuntime);
