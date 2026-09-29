import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresDatabase, type Database } from "../src/database.js";
import { createMigrationGate } from "../src/pilot/migrationGate.js";
import { controlMigration } from "./migrationControl.js";
import { createPostgresQueue } from "../src/pilot/postgresQueue.js";
import {
  MemoryStorage,
  workerFixture,
} from "../src/pilot/workerTestSupport.js";
import { runPilotJob } from "../src/pilot/worker.js";
import {
  PersistentAdmission,
  recoverExpiredExecutions,
} from "../src/pilot/admission.js";
import { GradingProviderError } from "../../grading-gateway/src/providers/providerTypes.js";
import { assertPilotRuntimePrivileges } from "../src/privileges.js";
import { verifyStandaloneHttp } from "./verifyStandaloneHttp.js";

export function assertStandaloneVerificationEnvironment(
  env: NodeJS.ProcessEnv,
) {
  if (
    env.PILOT_VERIFY_EMPTY_DATABASE !== "1" ||
    env.PILOT_VERIFY_LOCAL_ONLY !== "1" ||
    !env.DATABASE_URL ||
    !env.DATABASE_ADMIN_URL ||
    !env.DATABASE_CA_CERT
  )
    throw Error("standalone_verification_configuration_required");
  for (const [key, value] of Object.entries(env))
    if (
      value &&
      /(?:DEEPSEEK|OPENROUTER|OPENAI|KIMI|MOONSHOT|ANTHROPIC|GRADING_PROVIDER)/i.test(
        key,
      )
    )
      throw Error("standalone_verification_model_environment_forbidden");
  const urls = [new URL(env.DATABASE_URL), new URL(env.DATABASE_ADMIN_URL)];
  for (const url of urls)
    if (
      !/^postgres(?:ql)?:$/.test(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      !/^\/writewise_standalone_[a-f0-9]{12}$/.test(url.pathname) ||
      !url.port
    )
      throw Error("standalone_verification_disposable_local_database_required");
  if (urls[0].host !== urls[1].host || urls[0].pathname !== urls[1].pathname)
    throw Error("standalone_verification_database_mismatch");
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw Error("standalone_verification_wait_timeout");
}

export async function assertEmptyStandaloneDatabase(admin: Database) {
  const tables = (
    await admin.query<{ schemaname: string; tablename: string }>(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('pilot_auth','pilot_grading') ORDER BY schemaname,tablename",
    )
  ).rows;
  assert.equal(tables.length, 25, "expected_migrated_table_inventory");
  const controls = new Set([
    "pilot_auth.guard",
    "pilot_grading.provider_gate",
    "pilot_grading.migration_control",
  ]);
  for (const { schemaname, tablename } of tables) {
    assert.match(schemaname + "." + tablename, /^[a-z_]+\.[a-z_]+$/);
    const count = (
      await admin.query(
        `SELECT count(*)::integer AS n FROM ${schemaname}.${tablename}`,
      )
    ).rows[0].n;
    assert.equal(
      count,
      controls.has(schemaname + "." + tablename) ? 1 : 0,
      "requires_empty_synthetic_database",
    );
  }
  const gate = (
    await admin.query(
      "SELECT active_execution_id,pause_reason FROM pilot_grading.provider_gate",
    )
  ).rows[0];
  assert.equal(gate.active_execution_id, null);
  assert.equal(gate.pause_reason, null);
  assert.equal(
    (await admin.query("SELECT frozen FROM pilot_grading.migration_control"))
      .rows[0].frozen,
    false,
  );
  return tables.length;
}

/** Local disposable acceptance only. No cloud, secrets, real provider, or historical database is accepted. */
export async function verifyStandalonePostgres(env: NodeJS.ProcessEnv) {
  assertStandaloneVerificationEnvironment(env);
  const a = createPostgresDatabase(env.DATABASE_URL!, env.DATABASE_CA_CERT),
    b = createPostgresDatabase(env.DATABASE_URL!, env.DATABASE_CA_CERT),
    admin = createPostgresDatabase(
      env.DATABASE_ADMIN_URL!,
      env.DATABASE_CA_CERT,
    );
  const checks: string[] = [];
  try {
    const tableCount = await assertEmptyStandaloneDatabase(admin);
    assert.match(
      String(
        (await admin.query("SHOW server_version_num")).rows[0]
          .server_version_num,
      ),
      /^17\d{4}$/,
      "postgres_17_required",
    );
    await assertPilotRuntimePrivileges(a);
    const identity = await a.query(
      "SELECT pg_backend_pid() AS pid,current_user AS role,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls",
    );
    assert.equal(identity.rows[0].tls, true);
    assert.notEqual(
      identity.rows[0].pid,
      (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    assert.equal(
      (
        await a.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0].rolsuper,
      false,
    );
    assert.equal(
      (
        await a.query(
          "SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0].rolbypassrls,
      false,
    );
    await assert.rejects(
      a.query("UPDATE pilot_grading.migration_control SET frozen=true"),
    );
    await assert.rejects(
      a.query("DELETE FROM pilot_grading.migration_admissions"),
    );
    checks.push("strict_tls_two_restricted_connections");
    const gate = createMigrationGate(a),
      guarded = gate.guardDatabase(a);

    // Saturate the three-slot pool: each outer admission must reuse its own
    // backend for nested SQL/transactions, rather than waiting for a fourth.
    const ready = deferred(),
      release = deferred();
    let admitted = 0;
    const nested = Array.from({ length: 3 }, () =>
      gate.run(async () => {
        const pid = (await guarded.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        if (++admitted === 3) ready.resolve();
        await release.promise;
        const inner = await gate.run(() =>
          guarded.transaction(async (tx) => {
            const rows = await tx.query("SELECT pg_backend_pid() AS pid");
            assert.equal(
              (await guarded.query("SELECT pg_backend_pid() AS pid")).rows[0]
                .pid,
              pid,
            );
            return rows.rows[0].pid;
          }),
        );
        assert.equal(inner, pid);
        return pid;
      }),
    );
    await ready.promise;
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_operations",
    );
    await assert.rejects(
      createMigrationGate(b).run(async () => {
        throw Error("must_not_enter");
      }),
      /migration_frozen/,
    );
    release.resolve();
    assert.equal(new Set(await Promise.all(nested)).size, 3);
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_upload_expiry",
    );
    await assert.rejects(guarded.query("SELECT 1"), /migration_frozen/);
    assert.equal(
      (await controlMigration(admin, "status")).state,
      "waiting_upload_expiry",
    );
    assert.equal((await controlMigration(admin, "thaw")).state, "open");
    checks.push("three_pool_connections_nested_freeze_drain_explicit_thaw");

    // A parent rejection cannot release a child that still owns an effect.
    const childEntered = deferred(),
      childRelease = deferred();
    const aborted = gate.run(async () => {
      void gate.run(async () => {
        childEntered.resolve();
        await childRelease.promise;
        await guarded.query("SELECT 1");
      });
      await childEntered.promise;
      throw Error("synthetic_client_abort");
    });
    const abortObserved = assert.rejects(aborted, /synthetic_client_abort/);
    await childEntered.promise;
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_operations",
    );
    childRelease.resolve();
    await abortObserved;
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "waiting_upload_expiry",
    );
    await controlMigration(admin, "thaw");
    checks.push("aborted_parent_drains_child_effect");

    // Termination releases PostgreSQL locks, but never proves an external
    // effect finished. The durable marker must block both freeze and thaw.
    let terminatedPid = 0;
    const killReady = deferred(),
      killed = deferred();
    const terminated = gate.run(async () => {
      terminatedPid = Number(
        (await guarded.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      );
      killReady.resolve();
      await killed.promise;
      await assert.rejects(
        guarded.query("SELECT 1"),
        /migration_connection_lost|database_connection_lost/,
      );
    });
    const terminatedObserved = assert.rejects(
      terminated,
      /migration_connection_lost|database_connection_lost/,
    );
    await killReady.promise;
    const marker = (
      await admin.query<{ token: string }>(
        "SELECT token FROM pilot_grading.migration_admissions WHERE backend_pid=$1",
        [terminatedPid],
      )
    ).rows;
    assert.equal(marker.length, 1);
    assert.equal(
      (
        await admin.query("SELECT pg_terminate_backend($1) AS killed", [
          terminatedPid,
        ])
      ).rows[0].killed,
      true,
    );
    await waitFor(
      async () =>
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1",
            [terminatedPid],
          )
        ).rows[0].n === 0,
    );
    killed.resolve();
    await terminatedObserved;
    for (const action of ["freeze", "thaw"] as const)
      assert.equal(
        (await controlMigration(admin, action)).state,
        "blocked_uncertain_operations",
      );
    // Explicit cleanup is safe only here: this exact callback has settled and
    // only SELECTs were allowed. It is not a product orphan-recovery mechanism.
    await admin.query(
      "DELETE FROM pilot_grading.migration_admissions WHERE token=$1 AND backend_pid=$2",
      [marker[0].token, terminatedPid],
    );
    assert.equal((await controlMigration(admin, "thaw")).state, "open");
    checks.push("backend_death_poison_and_durable_orphan_block");

    const owners = [randomUUID(), randomUUID()];
    await admin.query(
      "INSERT INTO pilot_auth.batches(id,digest) VALUES('teacher-pilot-v1',$1)",
      ["0".repeat(64)],
    );
    for (const owner of owners)
      await admin.query(
        "INSERT INTO pilot_auth.accounts(id,batch_id,username,display_name,role,password_hash) VALUES($1,'teacher-pilot-v1',$2,'Synthetic verification','teacher','synthetic-unusable-hash')",
        [owner, "wj_" + randomUUID().replaceAll("-", "").slice(0, 24)],
      );
    const store = new MemoryStorage();
    const first = await workerFixture(a, store, owners[0]),
      second = await workerFixture(b, store, owners[1]);
    const qa = createPostgresQueue(a),
      qb = createPostgresQueue(b);
    await Promise.all([
      qa.publish(first.job.id, first.job.id + ":1"),
      qb.publish(first.job.id, first.job.id + ":1"),
    ]);
    const raced = await Promise.all([qa.lease(), qb.lease()]);
    assert.equal(raced.filter(Boolean).length, 1);
    const stale = raced.find(Boolean)!;
    await admin.query(
      "UPDATE pilot_grading.deliveries SET lease_expires_at=now()-interval '1 second' WHERE delivery_key=$1",
      [stale.deliveryKey],
    );
    const renewed = (await qb.lease())!;
    assert.notEqual(renewed.token, stale.token);
    assert.equal(await qa.acknowledge(stale), false);
    assert.equal(await qa.defer(stale, 0), false);
    assert.equal(await qb.defer(renewed, 60), true);
    assert.equal(await qa.lease(), undefined);
    await admin.query(
      "UPDATE pilot_grading.deliveries SET available_at=now()-interval '1 second' WHERE delivery_key=$1",
      [stale.deliveryKey],
    );
    const restarted = createPostgresDatabase(
      env.DATABASE_URL!,
      env.DATABASE_CA_CERT,
    );
    try {
      assert.equal(
        await createPostgresQueue(restarted).acknowledge(
          (await createPostgresQueue(restarted).lease())!,
        ),
        true,
      );
    } finally {
      await restarted.close();
    }
    assert.equal(await qa.lease(), undefined);
    checks.push("concurrent_lease_fenced_ack_delay_restart");
    let active = 0,
      peak = 0,
      calls = 0;
    const provider = {
      ...first.provider,
      gradeEssay: async (
        input: Parameters<typeof first.provider.gradeEssay>[0],
      ) => {
        active++;
        calls++;
        peak = Math.max(active, peak);
        try {
          await delay(40);
          return await first.provider.gradeEssay(input);
        } finally {
          active--;
        }
      },
    };
    const fixtures = [first, second];
    const outcomes = await Promise.all(
      fixtures.map((f) => runPilotJob(f.job.id, { ...f.deps, provider })),
    );
    for (let i = 0; i < fixtures.length; i++)
      if (outcomes[i] === "deferred")
        await runPilotJob(fixtures[i].job.id, {
          ...fixtures[i].deps,
          provider,
        });
    for (const fixture of fixtures)
      await runPilotJob(fixture.job.id, { ...fixture.deps, provider });
    assert.equal(peak, 1);
    assert.equal(calls, 2);
    checks.push("fake_provider_peak_one_redelivery_zero_extra_calls");

    const unknown = await workerFixture(a, store, owners[0]);
    const admission = new PersistentAdmission(a),
      claimed = await admission.claim(unknown.job.id);
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") throw Error("synthetic_claim_failed");
    assert.equal(await admission.beginCall(claimed.lease, 1000), true);
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
      (await unknown.jobs.get(owners[0], unknown.job.id)).state,
      "result_unknown",
    );
    await runPilotJob(unknown.job.id, { ...unknown.deps, provider });
    assert.equal(calls, 2);
    assert.equal(
      (await new PersistentAdmission(b).claim(unknown.job.id)).kind,
      "busy",
    );
    assert.equal(
      (await controlMigration(admin, "freeze")).state,
      "blocked_unknown_results",
    );
    assert.equal(
      (await controlMigration(admin, "thaw")).state,
      "blocked_unknown_results",
    );
    // No model was called for this fixture; settlement is known by construction.
    await admission.fail(
      claimed.lease,
      new GradingProviderError(
        "provider_unavailable",
        "Synthetic confirmed settlement",
        false,
        undefined,
        { termination: "confirmed" },
      ),
    );
    assert.equal((await controlMigration(admin, "thaw")).state, "open");
    checks.push("unknown_survives_recovery_redelivery_blocks_freeze_thaw");
    const crashed = await workerFixture(a, store, owners[0]);
    await qa.publish(crashed.job.id, crashed.job.id + ":1");
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(new URL("./standaloneCrashFixture.ts", import.meta.url)),
      ],
      {
        env: process.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const exited = once(child, "exit");
    child.stdin.end(JSON.stringify({ env, jobId: crashed.job.id }));
    try {
      await new Promise<void>((ok, reject) => {
        const timer = setTimeout(
          () => reject(Error("crash_fixture_timeout")),
          10000,
        );
        child.once("error", () => {
          clearTimeout(timer);
          reject(Error("crash_fixture_start_failed"));
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("crash_fixture_early_exit"));
        });
        child.stdout.once("data", (chunk) => {
          clearTimeout(timer);
          String(chunk).trim() === "synthetic_crash_ready"
            ? ok()
            : reject(Error("crash_fixture_protocol"));
        });
      });
      const orphan = (
        await admin.query<{ token: string; backend_pid: number }>(
          "SELECT token,backend_pid FROM pilot_grading.migration_admissions",
        )
      ).rows;
      assert.equal(orphan.length, 1);
      child.kill("SIGKILL");
      await exited;
      await waitFor(
        async () =>
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1",
              [orphan[0].backend_pid],
            )
          ).rows[0].n === 0,
      );
      const execution = (
        await admin.query<{ id: string; token: string; fence: number }>(
          "SELECT id,token,fence FROM pilot_grading.executions WHERE job_id=$1",
          [crashed.job.id],
        )
      ).rows[0];
      await admin.query(
        "UPDATE pilot_grading.executions SET call_deadline=now()-interval '1 day' WHERE id=$1",
        [execution.id],
      );
      await admin.query(
        "UPDATE pilot_grading.deliveries SET lease_expires_at=now()-interval '1 second' WHERE job_id=$1",
        [crashed.job.id],
      );
      await recoverExpiredExecutions(b);
      const recoveredDelivery = (await qb.lease())!;
      assert.equal(recoveredDelivery.jobId, crashed.job.id);
      await runPilotJob(crashed.job.id, { ...crashed.deps, provider });
      assert.equal(calls, 2);
      assert.equal(
        (await crashed.jobs.get(owners[0], crashed.job.id)).state,
        "result_unknown",
      );
      assert.equal(
        (await controlMigration(admin, "freeze")).state,
        "blocked_uncertain_operations",
      );
      assert.equal(
        (await controlMigration(admin, "thaw")).state,
        "blocked_uncertain_operations",
      );
      // Exact synthetic process is dead and its source performs no external
      // effect. Clear only its fixture marker, then prove unknown still blocks.
      await admin.query(
        "DELETE FROM pilot_grading.migration_admissions WHERE token=$1 AND backend_pid=$2",
        [orphan[0].token, orphan[0].backend_pid],
      );
      assert.equal(
        (await controlMigration(admin, "thaw")).state,
        "blocked_unknown_results",
      );
      await admission.fail(
        {
          executionId: execution.id,
          token: execution.token,
          fence: execution.fence,
        },
        new GradingProviderError(
          "provider_unavailable",
          "Synthetic child has no external effect",
          false,
          undefined,
          { termination: "confirmed" },
        ),
      );
      assert.equal(await qb.acknowledge(recoveredDelivery), true);
      assert.equal((await controlMigration(admin, "thaw")).state, "open");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    checks.push("killed_process_delivery_recovers_unknown_not_recalled");
    const http = await verifyStandaloneHttp(a, b, admin);
    const syntheticTasks = Number(
      (await admin.query("SELECT count(*)::int AS n FROM pilot_grading.tasks"))
        .rows[0].n,
    );
    return {
      passed: true,
      tableCount,
      checks,
      fakeProviderCalls: calls + http.fakeProviderCalls,
      realModelCalls: 0,
      peakProviderCalls: peak,
      syntheticAccounts: owners.length + http.syntheticAccounts,
      syntheticTasks,
      fixtureRowsRetained: true,
      explicitSyntheticOrphanCleanup: 2,
      http,
    };
  } finally {
    await Promise.allSettled([a.close(), b.close(), admin.close()]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  verifyStandalonePostgres(process.env)
    .then((report) => console.log(JSON.stringify(report)))
    .catch(() => {
      console.error("standalone_postgres_verification_failed");
      process.exitCode = 1;
    });
}
