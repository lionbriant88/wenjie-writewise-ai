import { randomBytes, randomUUID } from "node:crypto";
import { AuthRepository } from "../repository.js";
import { digest, keyedDigest } from "../crypto.js";
import type { AuthConfig } from "../config.js";
import { ownerA, ownerB, pilotTestDb } from "./testSupport.js";
export async function httpFixture() {
  const db = await pilotTestDb(),
    repo = new AuthRepository(db),
    admin = randomUUID();
  await db.query(
    "INSERT INTO pilot_auth.accounts(id,batch_id,username,display_name,role,password_hash) VALUES($1,'teacher-pilot-v1',$2,'Synthetic admin','admin','synthetic-hash')",
    [admin, "wj_" + randomBytes(12).toString("hex")],
  );
  const config: AuthConfig = {
    origin: "https://school.example",
    secret: "synthetic-http-secret-".repeat(3),
    secure: true,
    cookieName: "__Host-wj_session",
    trustedVercel: false,
    storage: "local",
  };
  const sessions = [];
  for (const owner of [ownerA, ownerB, admin]) {
    const value = randomBytes(32).toString("base64url");
    await repo.createSession(owner, 1, digest(value), new Date());
    sessions.push({
      owner,
      cookie: config.cookieName + "=" + value,
      csrf: keyedDigest(config.secret, "csrf:" + value),
    });
  }
  return { db, repo, config, sessions };
}
