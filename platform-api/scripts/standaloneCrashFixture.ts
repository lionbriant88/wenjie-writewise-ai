import assert from "node:assert/strict";
import { createPostgresDatabase } from "../src/database.js";
import { createMigrationGate } from "../src/pilot/migrationGate.js";
import { createPostgresQueue } from "../src/pilot/postgresQueue.js";
import { PersistentAdmission } from "../src/pilot/admission.js";
import { assertStandaloneVerificationEnvironment } from "./verifyStandalonePostgres.js";

// Private stdin supplies synthetic DB configuration, never argv or logs. This
// process performs no external effect/provider invocation; parent kills it.
async function main() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw Error("fixture_input_limit");
  }
  const { env, jobId } = JSON.parse(input) as {
    env: NodeJS.ProcessEnv;
    jobId: string;
  };
  assertStandaloneVerificationEnvironment({ ...process.env, ...env });
  const raw = createPostgresDatabase(env.DATABASE_URL!, env.DATABASE_CA_CERT),
    gate = createMigrationGate(raw),
    db = gate.guardDatabase(raw);
  await gate.run(async () => {
    const lease = await createPostgresQueue(db).lease();
    assert.equal(lease?.jobId, jobId);
    const admission = new PersistentAdmission(db),
      claimed = await admission.claim(jobId);
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") throw Error("fixture_claim");
    assert.equal(await admission.beginCall(claimed.lease), true);
    process.stdout.write("synthetic_crash_ready\n");
    await new Promise<void>(() => {
      setInterval(() => {}, 1000);
    });
  });
}
main().catch(() => {
  console.error("synthetic_crash_fixture_failed");
  process.exitCode = 1;
});
