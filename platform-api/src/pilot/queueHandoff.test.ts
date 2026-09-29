import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pilotTestDb, ownerA, ownerB } from "./testSupport.js";
import { handoffQueue, readHandoffConfig } from "../../scripts/queueHandoff.js";

async function fixture() {
  const db = await pilotTestDb();
  db.withConnection = (fn) =>
    fn({
      query: db.query,
      transaction: db.transaction,
      signal: new AbortController().signal,
    });
  const expected = String(
    (await db.query("SELECT current_database() AS name")).rows[0].name,
  );
  await db.exec(
    "UPDATE pilot_grading.migration_control SET frozen=true,frozen_at=now()",
  );
  async function job(state = "queued", owner = ownerA, deleted = false) {
    const task = randomUUID(),
      id = randomUUID();
    await db.query(
      "INSERT INTO pilot_grading.tasks(owner_id,id,draft,deleted_at) VALUES($1,$2,'{}',$3)",
      [owner, task, deleted ? new Date() : null],
    );
    await db.query(
      "INSERT INTO pilot_grading.jobs(owner_id,task_id,id,kind,draft_revision,logical_key,input_snapshot,state) VALUES($1,$2,$3,'rubric',1,$4,'{}',$5)",
      [owner, task, id, randomUUID().replaceAll("-", "").repeat(2), state],
    );
    await db.query(
      "INSERT INTO pilot_grading.outbox(job_id,generation,available_at,sent_at) VALUES($1,7,'2099-01-01T00:00:00.123Z',now())",
      [id],
    );
    return id;
  }
  async function maintenance(owner: string | null = null, state = "queued") {
    const id = randomUUID();
    await db.query(
      "INSERT INTO pilot_grading.maintenance_jobs(id,owner_id,state,generation,sent_at) VALUES($1,$2,$3,3,now())",
      [id, owner, state],
    );
    return id;
  }
  return { db, expected, job, maintenance };
}

it("seeds recent sent jobs and maintenance immediately with exact identity/delay, idempotently preserving completed deliveries", async () => {
  const f = await fixture();
  try {
    const job = await f.job(),
      completed = await f.job(),
      maintenance = await f.maintenance();
    await f.db.query(
      "INSERT INTO pilot_grading.deliveries(delivery_key,job_id,completed_at) VALUES($1,$2,now())",
      [completed + ":7", completed],
    );
    expect(await handoffQueue(f.db, "to-postgres", f.expected)).toEqual({
      jobs: 1,
      maintenance: 1,
    });
    expect(await handoffQueue(f.db, "to-postgres", f.expected)).toEqual({
      jobs: 0,
      maintenance: 0,
    });
    const rows = (
      await f.db.query(
        "SELECT delivery_key,available_at,completed_at FROM pilot_grading.deliveries ORDER BY delivery_key",
      )
    ).rows;
    const pending = rows.find((r) => r.delivery_key === job + ":7")!;
    expect((pending.available_at as Date).toISOString()).toBe(
      "2099-01-01T00:00:00.123Z",
    );
    expect(
      rows.find((r) => r.delivery_key === completed + ":7")?.completed_at,
    ).not.toBeNull();
    expect(rows.some((r) => r.delivery_key === maintenance + ":3")).toBe(true);
    expect(
      (await f.db.query("SELECT sent_at FROM pilot_grading.outbox")).rows.every(
        (r) => r.sent_at !== null,
      ),
    ).toBe(true);
  } finally {
    await f.db.close();
  }
});
it("excludes terminal, disabled and deleted work in both directions, preserving generations and dates in reverse", async () => {
  const f = await fixture();
  try {
    const eligible = await f.job();
    await f.job("succeeded");
    await f.job("queued", ownerA, true);
    await f.job("queued", ownerB);
    const maintenance = await f.maintenance(ownerA);
    await f.maintenance(ownerB);
    await f.maintenance(null, "done");
    await f.db.query(
      "UPDATE pilot_auth.accounts SET status='disabled' WHERE id=$1",
      [ownerB],
    );
    expect(await handoffQueue(f.db, "to-postgres", f.expected)).toEqual({
      jobs: 1,
      maintenance: 1,
    });
    expect(await handoffQueue(f.db, "to-vercel", f.expected)).toEqual({
      jobs: 1,
      maintenance: 1,
    });
    expect(await handoffQueue(f.db, "to-vercel", f.expected)).toEqual({
      jobs: 0,
      maintenance: 0,
    });
    expect(
      (
        await f.db.query(
          "SELECT job_id,generation,available_at FROM pilot_grading.outbox WHERE sent_at IS NULL",
        )
      ).rows,
    ).toEqual([
      {
        job_id: eligible,
        generation: 7,
        available_at: new Date("2099-01-01T00:00:00.123Z"),
      },
    ]);
    expect(
      (
        await f.db.query(
          "SELECT id,generation FROM pilot_grading.maintenance_jobs WHERE sent_at IS NULL",
        )
      ).rows,
    ).toEqual([{ id: maintenance, generation: 3 }]);
  } finally {
    await f.db.close();
  }
});
it.each([
  "open",
  "unknown",
  "running",
  "admission",
  "calling",
  "occupied",
  "wrong_database",
])("rejects %s without changing queue state", async (state) => {
  const f = await fixture();
  try {
    const id = await f.job(
      state === "unknown"
        ? "result_unknown"
        : state === "running"
          ? "running"
          : "queued",
    );
    if (state === "open")
      await f.db.exec(
        "UPDATE pilot_grading.migration_control SET frozen=false,frozen_at=NULL",
      );
    if (state === "admission")
      await f.db.query(
        "INSERT INTO pilot_grading.migration_admissions(token,backend_pid,backend_started_at) VALUES($1,1,now())",
        [randomUUID()],
      );
    if (state === "calling" || state === "occupied") {
      const x = randomUUID();
      await f.db.query(
        "INSERT INTO pilot_grading.executions(id,job_id,token,fence,state,prepare_deadline) VALUES($1,$2,$3,1,$4,now())",
        [x, id, randomUUID(), state === "calling" ? "calling" : "finished"],
      );
      if (state === "occupied")
        await f.db.query(
          "UPDATE pilot_grading.provider_gate SET active_execution_id=$1",
          [x],
        );
    }
    await expect(
      handoffQueue(
        f.db,
        "to-postgres",
        state === "wrong_database" ? "other" : f.expected,
      ),
    ).rejects.toThrow(
      state === "wrong_database"
        ? "queue_handoff_database_mismatch"
        : "queue_handoff_not_frozen_and_settled",
    );
    expect(
      (await f.db.query("SELECT * FROM pilot_grading.deliveries")).rows,
    ).toHaveLength(0);
    expect(
      (await f.db.query("SELECT sent_at FROM pilot_grading.outbox")).rows[0]
        .sent_at,
    ).not.toBeNull();
  } finally {
    await f.db.close();
  }
});
it("pins CLI mode, expected database, source project/session port, loopback target and explicit CA before any connection", () => {
  const target = {
    DATABASE_ADMIN_URL:
      "postgresql://admin:synthetic@127.0.0.1:5432/writewise_stage",
    DATABASE_CA_CERT: "synthetic-ca",
  };
  expect(
    readHandoffConfig(
      ["to-postgres", "--expected-database", "writewise_stage"],
      target,
    ),
  ).toMatchObject({ mode: "to-postgres", expectedDatabase: "writewise_stage" });
  const source = {
    ...target,
    DATABASE_ADMIN_URL:
      "postgresql://postgres.wudbhdyqgnbnuorebhnu:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
  };
  expect(
    readHandoffConfig(["to-vercel", "--expected-database", "postgres"], source),
  ).toMatchObject({ mode: "to-vercel" });
  for (const env of [
    { ...target, DATABASE_CA_CERT: "" },
    {
      ...target,
      DATABASE_ADMIN_URL: target.DATABASE_ADMIN_URL.replace(
        "127.0.0.1",
        "localhost",
      ),
    },
    {
      ...target,
      DATABASE_ADMIN_URL: target.DATABASE_ADMIN_URL + "?sslmode=disable",
    },
  ])
    expect(() =>
      readHandoffConfig(
        ["to-postgres", "--expected-database", "writewise_stage"],
        env,
      ),
    ).toThrow();
  for (const url of [
    source.DATABASE_ADMIN_URL.replace(":5432", ":6543"),
    source.DATABASE_ADMIN_URL.replace("wudbhdyqgnbnuorebhnu", "wrongproject"),
    source.DATABASE_ADMIN_URL.replace(
      "aws-0-ap-southeast-1",
      "aws-0-us-east-1",
    ),
  ])
    expect(() =>
      readHandoffConfig(["to-vercel", "--expected-database", "postgres"], {
        ...source,
        DATABASE_ADMIN_URL: url,
      }),
    ).toThrow();
  expect(() =>
    readHandoffConfig(["to-postgres", "--expected-database", "other"], target),
  ).toThrow();
  expect(() => readHandoffConfig([], target)).toThrow();
});
