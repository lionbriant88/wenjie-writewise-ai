import { readConfig } from "./config.js";
import { createApp } from "./server.js";
import { AuthRepository } from "./repository.js";
import { assertRuntimePrivileges } from "./privileges.js";
import { getRuntimeApp, openStandaloneRuntime } from "./runtime.js";
async function start() {
  const config = readConfig(process.env);
  let app;
  let close: undefined | (() => Promise<void>);
  if (process.env.PILOT_DEPLOYMENT_MODE === "standalone") {
    const runtime = await openStandaloneRuntime(process.env);
    app = runtime.app;
    close = runtime.close;
  } else if (process.env.PILOT_DEPLOYMENT_MODE) {
    throw Error("deployment_mode_invalid");
  } else if (config.storage === "local") {
    const { createLocalDatabase } = await import("./localDatabase.js");
    const db = createLocalDatabase(config.localPath);
    close = () => db.close();
    try {
      await db.exec("SET ROLE wj_auth_runtime");
      await assertRuntimePrivileges(db);
      app = createApp(new AuthRepository(db), config);
    } catch (error) {
      await db.close();
      throw error;
    }
  } else app = await getRuntimeApp();
  const port = Number(process.env.PORT || 8793);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("invalid_port");
  const server = app.listen(port, "127.0.0.1", () =>
    console.log("account_api_listening"),
  );
  const stop = () =>
    server.close(() => {
      void (close?.() ?? Promise.resolve()).finally(() => process.exit(0));
    });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
start().catch(() => {
  console.error("account_api_start_failed");
  process.exitCode = 1;
});
