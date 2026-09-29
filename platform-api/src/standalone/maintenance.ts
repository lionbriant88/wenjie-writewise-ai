import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openStandaloneRuntime } from "../runtime.js";
import { recoverPilotWork, type RecoveryDeps } from "../pilot/recovery.js";
import type { MigrationGate } from "../pilot/migrationGate.js";
export async function runStandaloneMaintenance(
  runtime: RecoveryDeps & { migrationGate: MigrationGate },
) {
  return runtime.migrationGate.run(() => recoverPilotWork(runtime, 50));
}
export async function executeStandaloneMaintenance(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.PILOT_MAINTENANCE_ENABLED !== "1")
    throw Error("maintenance_not_enabled");
  const runtime = await openStandaloneRuntime(env, "maintenance");
  try {
    await runStandaloneMaintenance({
      ...runtime.pilotRuntime,
      migrationGate: runtime.pilotRuntime.migrationGate!,
    });
  } finally {
    await runtime.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  executeStandaloneMaintenance().catch(() => {
    console.error("standalone_maintenance_failed");
    process.exitCode = 1;
  });
