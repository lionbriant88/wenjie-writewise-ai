import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPostgresDatabase, type Database } from "../src/database.js";
import { PilotJobRepository } from "../src/pilot/jobs.js";
import { PilotCleanupService } from "../src/pilot/cleanup.js";
import {
  PersistentAdmission,
  recoverExpiredExecutions,
} from "../src/pilot/admission.js";
import {
  MemoryStorage,
  workerFixture,
} from "../src/pilot/workerTestSupport.js";
import { seedEssay } from "../src/pilot/jobTestSupport.js";
import { command } from "../src/pilot/testSupport.js";
import { runPilotJob } from "../src/pilot/worker.js";
import { GradingProviderError } from "../../grading-gateway/src/providers/providerTypes.js";
import { assertPilotRuntimePrivileges } from "../src/privileges.js";

/** Deployment-time test only: refuses any existing teacher business data, uses no real model or Storage. */
export async function verifyPilotPostgres(env: NodeJS.ProcessEnv) {
  if (
    !env.DATABASE_URL ||
    !env.DATABASE_ADMIN_URL ||
    !env.DATABASE_CA_CERT ||
    env.PILOT_VERIFY_EMPTY_DATABASE !== "1"
  )
    throw Error("postgres_verification_configuration_required");
  const a = createPostgresDatabase(env.DATABASE_URL, env.DATABASE_CA_CERT),
    b = createPostgresDatabase(env.DATABASE_URL, env.DATABASE_CA_CERT),
    admin = createPostgresDatabase(
      env.DATABASE_ADMIN_URL,
      env.DATABASE_CA_CERT,
    );
  const fixtures: { owner: string; task: string }[] = [];
  let cleanupComplete = false;
  try {
    assert.equal(
      (await admin.query("SELECT count(*)::int AS n FROM pilot_grading.tasks"))
        .rows[0].n,
      0,
      "requires_empty_pilot_business_tables",
    );
    const gate = (
      await admin.query("SELECT * FROM pilot_grading.provider_gate")
    ).rows[0];
    assert.equal(gate.active_execution_id, null);
    assert.equal(gate.pause_reason, null);
    await assertPilotRuntimePrivileges(a);
    await assertPilotRuntimePrivileges(b);
    const pidA = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    assert.notEqual(pidA, pidB, "requires_two_real_connections");
    const owners = (
      await a.query<{ id: string }>(
        "SELECT id FROM pilot_auth.accounts WHERE role='teacher' AND status='active' ORDER BY id LIMIT 2",
      )
    ).rows;
    assert.equal(owners.length, 2);
    const store = new MemoryStorage();
    const first = await workerFixture(a, store, owners[0].id);
    fixtures.push({ owner: owners[0].id, task: first.task.id });
    const second = await workerFixture(b, store, owners[1].id);
    fixtures.push({ owner: owners[1].id, task: second.task.id });
    const same = await seedEssay(a, owners[0].id);
    fixtures.push({ owner: owners[0].id, task: same.task.id });
    const jobsA = new PilotJobRepository(a),
      jobsB = new PilotJobRepository(b);
    const racing = await Promise.all([
      jobsA.enqueueTask(owners[0].id, same.task.id, command({})),
      jobsB.enqueueTask(owners[0].id, same.task.id, command({})),
    ]);
    assert.equal(
      racing.reduce((sum, r) => sum + r.accepted, 0),
      1,
      "one_logical_job",
    );
    let concurrent = 0,
      peak = 0,
      calls = 0;
    const provider = {
      ...first.provider,
      gradeEssay: async (
        input: Parameters<typeof first.provider.gradeEssay>[0],
      ) => {
        concurrent++;
        calls++;
        peak = Math.max(peak, concurrent);
        try {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return await first.provider.gradeEssay(input);
        } finally {
          concurrent--;
        }
      },
    };
    const workloads = [
      { ...first.deps, provider },
      { ...second.deps, provider },
    ];
    const ids = [first.job.id, second.job.id];
    const outcomes = await Promise.all(
      ids.map((id, i) => runPilotJob(id, workloads[i])),
    );
    for (let i = 0; i < ids.length; i++)
      if (outcomes[i] === "deferred") await runPilotJob(ids[i], workloads[i]);
    for (let i = 0; i < ids.length; i++)
      await runPilotJob(ids[i], workloads[i]);
    assert.equal(peak, 1);
    assert.equal(calls, 2, "duplicate_delivery_zero_calls");
    const job = (await same.essays.get(owners[0].id, same.essay.id))
      .currentJob!;
    const admission = new PersistentAdmission(a),
      claimed = await admission.claim(job.id);
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") throw Error("synthetic_claim");
    assert.equal(await admission.beginCall(claimed.lease, 1000), true);
    // No external Provider is invoked here. The original synthetic lease is kept for a confirmed late termination.
    await admission.fail(
      claimed.lease,
      new GradingProviderError(
        "provider_timeout",
        "Synthetic unknown",
        false,
        undefined,
        { termination: "unknown" },
      ),
    );
    await admin.query(
      "UPDATE pilot_grading.executions SET call_deadline=now()-interval '1 day' WHERE id=$1",
      [claimed.lease.executionId],
    );
    await recoverExpiredExecutions(b);
    assert.equal(
      (await jobsB.get(owners[0].id, job.id)).state,
      "result_unknown",
    );
    assert.equal((await new PersistentAdmission(b).claim(job.id)).kind, "busy");
    await admission.fail(
      claimed.lease,
      new GradingProviderError(
        "provider_unavailable",
        "Synthetic confirmed late termination",
        false,
        undefined,
        { termination: "confirmed" },
      ),
    );
    assert.equal(
      (
        await admin.query(
          "SELECT active_execution_id FROM pilot_grading.provider_gate",
        )
      ).rows[0].active_execution_id,
      null,
    );
    for (const fixture of fixtures) {
      const revision = (
        await a.query<{ revision: number }>(
          "SELECT revision FROM pilot_grading.tasks WHERE id=$1",
          [fixture.task],
        )
      ).rows[0].revision;
      await new PilotCleanupService(a, store).deleteTask(
        fixture.owner,
        fixture.task,
        command({}, revision),
      );
    }
    await admin.query(
      "UPDATE pilot_grading.uploads SET last_signed_at=now()-interval '3 hours' WHERE task_id=ANY($1::uuid[])",
      [fixtures.map((f) => f.task)],
    );
    await new PilotCleanupService(a, store).runBatch(50);
    await removeSyntheticRows(
      admin,
      fixtures.map((f) => f.task),
    );
    assert.equal(
      (await a.query("SELECT count(*)::int AS n FROM pilot_grading.tasks"))
        .rows[0].n,
      0,
    );
    cleanupComplete = true;
    return {
      passed: true,
      independentConnections: true,
      peakProviderCalls: peak,
      modelCalls: calls,
      unknownRetained: true,
      cleanupComplete,
    };
  } finally {
    // An interrupted test never deletes an active/unknown execution or changes the existing auth accounts.
    await Promise.allSettled([a.close(), b.close(), admin.close()]);
  }
}
async function removeSyntheticRows(db: Database, ids: string[]) {
  await db.transaction(async (tx) => {
    assert.equal(
      (
        await tx.query(
          "SELECT active_execution_id FROM pilot_grading.provider_gate FOR UPDATE",
        )
      ).rows[0].active_execution_id,
      null,
    );
    for (const table of ["executions", "outbox"])
      await tx.query(
        `DELETE FROM pilot_grading.${table} WHERE job_id IN (SELECT id FROM pilot_grading.jobs WHERE task_id=ANY($1::uuid[]))`,
        [ids],
      );
    for (const table of [
      "jobs",
      "essay_sources",
      "essays",
      "task_revisions",
      "uploads",
    ])
      await tx.query(
        `DELETE FROM pilot_grading.${table} WHERE task_id=ANY($1::uuid[])`,
        [ids],
      );
    await tx.query(
      "DELETE FROM pilot_grading.command_receipts WHERE operation=ANY($1::text[])",
      [ids.map((id) => "task:delete:" + id)],
    );
    await tx.query(
      "DELETE FROM pilot_grading.tasks WHERE id=ANY($1::uuid[]) AND deleted_at IS NOT NULL AND content_purged_at IS NOT NULL",
      [ids],
    );
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  verifyPilotPostgres(process.env)
    .then((report) => console.log(JSON.stringify(report)))
    .catch(() => {
      console.error("pilot_postgres_verification_failed");
      process.exitCode = 1;
    });
}
