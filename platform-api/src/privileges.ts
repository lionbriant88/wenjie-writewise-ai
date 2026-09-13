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
