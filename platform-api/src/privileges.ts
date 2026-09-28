import type { Queryable } from "./database.js";
export async function assertRuntimePrivileges(db: Queryable): Promise<void> {
  const row = (
    await db.query<{
      safe: boolean;
    }>(`SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
    AND NOT has_schema_privilege(current_user,'pilot_auth','CREATE')
    AND NOT has_table_privilege(current_user,'pilot_auth.accounts','INSERT,DELETE,TRUNCATE')
    AND NOT has_column_privilege(current_user,'pilot_auth.accounts','password_hash','UPDATE')
    AND NOT has_column_privilege(current_user,'pilot_auth.accounts','role','UPDATE')
    AND has_table_privilege(current_user,'pilot_auth.accounts','SELECT') AS safe
    FROM pg_roles r WHERE r.rolname=current_user`)
  ).rows[0];
  if (!row?.safe) throw Error("unsafe_database_role");
}
export async function assertPilotRuntimePrivileges(
  db: Queryable,
): Promise<void> {
  await assertRuntimePrivileges(db);
  const requirements: Record<string, string[]> = {
    tasks: ["SELECT", "INSERT", "UPDATE"],
    task_revisions: ["SELECT", "INSERT", "UPDATE"],
    command_receipts: ["SELECT", "INSERT", "DELETE"],
    uploads: ["SELECT", "INSERT", "UPDATE"],
    task_material_uploads: ["SELECT", "INSERT", "DELETE"],
    essays: ["SELECT", "INSERT", "UPDATE"],
    essay_sources: ["SELECT", "INSERT", "UPDATE"],
    essay_pages: ["SELECT", "INSERT", "DELETE"],
    jobs: ["SELECT", "INSERT", "UPDATE"],
    job_uploads: ["SELECT", "INSERT", "DELETE"],
    executions: ["SELECT", "INSERT", "UPDATE"],
    provider_gate: ["SELECT", "UPDATE"],
    outbox: ["SELECT", "INSERT", "UPDATE"],
    grading_results: ["SELECT", "INSERT", "DELETE"],
    teacher_reviews: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    maintenance_jobs: ["SELECT", "INSERT", "UPDATE"],
  };
  const schema = (
    await db.query<{ safe: boolean }>(
      `SELECT has_schema_privilege(current_user,'pilot_grading','USAGE') AND NOT has_schema_privilege(current_user,'pilot_grading','CREATE') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND has_schema_privilege(oid,'pilot_grading','USAGE')) AS safe`,
    )
  ).rows[0];
  if (!schema?.safe) throw Error("unsafe_pilot_database_role");
  for (const [table, privileges] of Object.entries(requirements))
    for (const privilege of privileges) {
      const row = (
        await db.query<{ safe: boolean }>(
          "SELECT has_table_privilege(current_user,$1,$2) AS safe",
          ["pilot_grading." + table, privilege],
        )
      ).rows[0];
      if (!row?.safe) throw Error("pilot_database_not_ready");
    }
}
