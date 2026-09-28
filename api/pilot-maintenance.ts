import { createMaintenanceHandler } from "../platform-api/src/pilot/maintenanceHandler.js";
import { getPilotRuntime } from "../platform-api/src/pilot/runtime.js";
export default createMaintenanceHandler(getPilotRuntime);
