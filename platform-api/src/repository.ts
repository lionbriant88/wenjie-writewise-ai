import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "./database.js";
import { HttpError, unauthorized } from "./errors.js";
export interface Account extends Record<string, unknown> {
  id: string;
  username: string;
  display_name: string;
  role: "teacher" | "admin";
  status: "active" | "disabled";
  password_hash: string;
  session_version: number;
  last_login_at: Date | string | null;
}
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: "teacher" | "admin";
  status: "active" | "disabled";
  lastLoginAt: string | null;
}
export const publicUser = (a: Account): PublicUser => ({
  id: a.id,
  username: a.username,
  displayName: a.display_name,
  role: a.role,
  status: a.status,
  lastLoginAt: a.last_login_at ? new Date(a.last_login_at).toISOString() : null,
});
export const absoluteMs = (role: Account["role"]) =>
  role === "admin" ? 12 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
const idleMs = (role: Account["role"]) =>
  role === "admin" ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
export class AuthRepository {
  constructor(readonly db: Database) {}
  async findLogin(username: string): Promise<Account | undefined> {
    return (
      await this.db.query<Account>(
        "SELECT * FROM pilot_auth.accounts WHERE username=$1",
        [username],
      )
    ).rows[0];
  }
  async createSession(
    accountId: string,
    version: number,
    tokenHash: string,
    now: Date,
  ): Promise<Account | undefined> {
    return this.db.transaction(async (tx) => {
      const account = (
        await tx.query<Account>(
          "SELECT * FROM pilot_auth.accounts WHERE id=$1 FOR UPDATE",
          [accountId],
        )
      ).rows[0];
      if (
        !account ||
        account.status !== "active" ||
        account.session_version !== version
      )
        return undefined;
      await tx.query(
        "INSERT INTO pilot_auth.sessions (token_hash,account_id,session_version,created_at,expires_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,$4)",
        [
          tokenHash,
          account.id,
          version,
          now,
          new Date(now.getTime() + absoluteMs(account.role)),
        ],
      );
      const updated = (
        await tx.query<Account>(
          "UPDATE pilot_auth.accounts SET last_login_at=$1 WHERE id=$2 RETURNING *",
          [now, account.id],
        )
      ).rows[0];
      await tx.query(
        "DELETE FROM pilot_auth.sessions WHERE token_hash IN (SELECT token_hash FROM pilot_auth.sessions WHERE expires_at <= $1 ORDER BY token_hash LIMIT 100 FOR UPDATE SKIP LOCKED)",
        [now],
      );
      return updated;
    });
  }
  private async sessionIn(
    tx: Queryable,
    tokenHash: string,
    now: Date,
  ): Promise<Account | undefined> {
    const row = (
      await tx.query<
        Account & {
          expires_at: Date;
          last_seen_at: Date;
          session_id_version: number;
        }
      >(
        `SELECT a.*,s.expires_at,s.last_seen_at,s.session_version AS session_id_version
      FROM pilot_auth.sessions s JOIN pilot_auth.accounts a ON a.id=s.account_id
      WHERE s.token_hash=$1 FOR UPDATE OF a,s`,
        [tokenHash],
      )
    ).rows[0];
    if (
      !row ||
      row.status !== "active" ||
      row.session_version !== row.session_id_version ||
      new Date(row.expires_at).getTime() <= now.getTime() ||
      new Date(row.last_seen_at).getTime() + idleMs(row.role) <= now.getTime()
    )
      return undefined;
    await tx.query(
      "UPDATE pilot_auth.sessions SET last_seen_at=$1 WHERE token_hash=$2",
      [now, tokenHash],
    );
    return row;
  }
  session(tokenHash: string, now: Date) {
    return this.db.transaction((tx) => this.sessionIn(tx, tokenHash, now));
  }
  async logout(tokenHash: string) {
    await this.db.query("DELETE FROM pilot_auth.sessions WHERE token_hash=$1", [
      tokenHash,
    ]);
  }
  async listAccounts(tokenHash: string, now: Date): Promise<PublicUser[]> {
    return this.db.transaction(async (tx) => {
      const actor = await this.sessionIn(tx, tokenHash, now);
      this.assertAdmin(actor);
      return (
        await tx.query<Account>(
          "SELECT * FROM pilot_auth.accounts ORDER BY role,display_name,id",
        )
      ).rows.map(publicUser);
    });
  }
  private assertAdmin(actor: Account | undefined): asserts actor is Account {
    if (!actor) throw unauthorized();
    if (actor.role !== "admin")
      throw new HttpError(403, "forbidden", "仅账号管理员可操作。");
  }
  async patchAccount(
    tokenHash: string,
    id: string,
    patch: { status?: "active" | "disabled"; displayName?: string },
    now: Date,
  ): Promise<PublicUser> {
    return this.db.transaction(async (tx) => {
      // The shared guard serializes admin status changes, including cross-admin disables.
      await tx.query("SELECT id FROM pilot_auth.guard WHERE id=1 FOR UPDATE");
      const actor = await this.sessionIn(tx, tokenHash, now);
      this.assertAdmin(actor);
      const target = (
        await tx.query<Account>(
          "SELECT * FROM pilot_auth.accounts WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!target) throw new HttpError(404, "not_found", "账号不存在。");
      if (
        target.role === "admin" &&
        target.status === "active" &&
        patch.status === "disabled"
      ) {
        const active = (
          await tx.query(
            "SELECT id FROM pilot_auth.accounts WHERE role='admin' AND status='active'",
          )
        ).rows;
        if (active.length <= 1)
          throw new HttpError(
            409,
            "last_admin",
            "不能停用最后一个有效管理员。",
          );
      }
      const disabling =
        target.status === "active" && patch.status === "disabled";
      const account = (
        await tx.query<Account>(
          "UPDATE pilot_auth.accounts SET display_name=$1,status=$2,session_version=session_version+$3 WHERE id=$4 RETURNING *",
          [
            patch.displayName ?? target.display_name,
            patch.status ?? target.status,
            disabling ? 1 : 0,
            id,
          ],
        )
      ).rows[0];
      if (disabling)
        await tx.query("DELETE FROM pilot_auth.sessions WHERE account_id=$1", [
          id,
        ]);
      await tx.query(
        "INSERT INTO pilot_auth.audit (id,actor_id,target_id,action,changed_fields,created_at) VALUES ($1,$2,$3,'account_updated',$4,$5)",
        [randomUUID(), actor.id, id, Object.keys(patch).sort(), now],
      );
      return publicUser(account);
    });
  }
  async takeRateLimit(
    accountBucket: string,
    sourceBucket: string,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      let allowed = true;
      // Stable lock ordering prevents deadlocks for requests sharing only one bucket.
      for (const { bucket, limit } of [
        { bucket: accountBucket, limit: 8 },
        { bucket: sourceBucket, limit: 60 },
      ].sort((a, b) => a.bucket.localeCompare(b.bucket))) {
        const row = (
          await tx.query<{ attempts: number }>(
            `INSERT INTO pilot_auth.rate_limits (bucket,window_start,attempts) VALUES ($1,$2,1)
          ON CONFLICT (bucket) DO UPDATE SET
          attempts=CASE WHEN pilot_auth.rate_limits.window_start <= $2::timestamptz - interval '15 minutes' THEN 1 ELSE LEAST(pilot_auth.rate_limits.attempts+1,1000000) END,
          window_start=CASE WHEN pilot_auth.rate_limits.window_start <= $2::timestamptz - interval '15 minutes' THEN $2 ELSE pilot_auth.rate_limits.window_start END RETURNING attempts`,
            [bucket, now],
          )
        ).rows[0];
        if (row.attempts > limit) allowed = false;
      }
      await tx.query(
        "DELETE FROM pilot_auth.rate_limits WHERE bucket IN (SELECT bucket FROM pilot_auth.rate_limits WHERE window_start < $1::timestamptz-interval '15 minutes' ORDER BY bucket LIMIT 100 FOR UPDATE SKIP LOCKED)",
        [now],
      );
      return allowed;
    });
  }
}
