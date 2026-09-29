import { isAbsolute } from "node:path";
export interface AuthConfig {
  origin: string;
  secret: string;
  secure: boolean;
  cookieName: string;
  trustedVercel: boolean;
  trustedLoopbackProxy?: boolean;
  storage: "postgres" | "local";
  databaseUrl?: string;
  ca?: string;
  localPath?: string;
}
export function readConfig(env: NodeJS.ProcessEnv): AuthConfig {
  if (env.TRUST_LOOPBACK_PROXY && env.TRUST_LOOPBACK_PROXY !== "1")
    throw Error("configuration_invalid");
  if (env.TRUST_LOOPBACK_PROXY === "1" && env.VERCEL === "1")
    throw Error("configuration_invalid");
  const production = env.NODE_ENV === "production" || env.VERCEL === "1";
  const storage = env.AUTH_STORAGE || "postgres";
  if (
    !["postgres", "local"].includes(storage) ||
    (production && storage === "local")
  )
    throw Error("configuration_invalid");
  if (
    !env.APP_ORIGIN ||
    !env.AUTH_RATE_LIMIT_SECRET ||
    env.AUTH_RATE_LIMIT_SECRET.length < 32
  )
    throw Error("configuration_missing");
  let url: URL;
  try {
    url = new URL(env.APP_ORIGIN);
  } catch {
    throw Error("configuration_invalid");
  }
  if (url.origin !== env.APP_ORIGIN || url.username || url.password)
    throw Error("configuration_invalid");
  const secure = url.protocol === "https:";
  if (
    !secure &&
    (production ||
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw Error("configuration_invalid");
  if (
    (storage === "postgres" && !env.DATABASE_URL) ||
    (storage === "local" && !env.AUTH_LOCAL_PATH)
  )
    throw Error("configuration_missing");
  if (env.DATABASE_URL) {
    let database: URL;
    try {
      database = new URL(env.DATABASE_URL);
    } catch {
      throw Error("configuration_invalid");
    }
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      throw Error("configuration_invalid");
  }
  return {
    origin: url.origin,
    secret: env.AUTH_RATE_LIMIT_SECRET,
    secure,
    cookieName: secure ? "__Host-wj_session" : "wj_dev_session",
    trustedVercel: env.VERCEL === "1",
    trustedLoopbackProxy: env.TRUST_LOOPBACK_PROXY === "1",
    storage: storage as AuthConfig["storage"],
    databaseUrl: env.DATABASE_URL,
    ca: env.DATABASE_CA_CERT,
    localPath: env.AUTH_LOCAL_PATH,
  };
}

export interface PilotConfig {
  storage: "supabase" | "disk";
  queue: "vercel" | "postgres";
  migrationGate: boolean;
  diskRoot?: string;
  signingKey?: string;
}
export function readPilotConfig(
  env: NodeJS.ProcessEnv,
  standalone = false,
): PilotConfig {
  const storage = env.PILOT_STORAGE_BACKEND ?? "supabase";
  const queue = env.PILOT_QUEUE_BACKEND ?? "vercel";
  if (
    !["supabase", "disk"].includes(storage) ||
    !["vercel", "postgres"].includes(queue) ||
    (env.PILOT_MIGRATION_GATE_ENABLED !== undefined &&
      !["0", "1"].includes(env.PILOT_MIGRATION_GATE_ENABLED))
  )
    throw Error("pilot_configuration_invalid");
  const migrationGate = env.PILOT_MIGRATION_GATE_ENABLED === "1";
  if (
    storage === "disk" &&
    (!env.PILOT_DISK_ROOT ||
      !isAbsolute(env.PILOT_DISK_ROOT) ||
      (env.PILOT_FILE_SIGNING_KEY?.length ?? 0) < 32 ||
      !migrationGate)
  )
    throw Error("pilot_configuration_invalid");
  if (
    standalone &&
    (env.PILOT_MVP_ENABLED !== "1" ||
      storage !== "disk" ||
      queue !== "postgres" ||
      !migrationGate)
  )
    throw Error("standalone_configuration_incomplete");
  return {
    storage: storage as PilotConfig["storage"],
    queue: queue as PilotConfig["queue"],
    migrationGate,
    diskRoot: env.PILOT_DISK_ROOT,
    signingKey: env.PILOT_FILE_SIGNING_KEY,
  };
}
