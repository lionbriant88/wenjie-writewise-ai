export interface AuthConfig {
  origin: string;
  secret: string;
  secure: boolean;
  cookieName: string;
  trustedVercel: boolean;
  storage: "postgres" | "local";
  databaseUrl?: string;
  ca?: string;
  localPath?: string;
}
export function readConfig(env: NodeJS.ProcessEnv): AuthConfig {
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
    storage: storage as AuthConfig["storage"],
    databaseUrl: env.DATABASE_URL,
    ca: env.DATABASE_CA_CERT,
    localPath: env.AUTH_LOCAL_PATH,
  };
}
