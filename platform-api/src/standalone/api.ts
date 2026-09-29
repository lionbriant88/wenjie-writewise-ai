import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openStandaloneRuntime } from "../runtime.js";
export async function startStandaloneApi(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 8793);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("invalid_port");
  // Dedicated executable: omitting a mode flag can never fall back to auth-only.
  const runtime = await openStandaloneRuntime(env);
  const server = runtime.app.listen(port, "127.0.0.1", () =>
    console.log("standalone_api_listening"),
  );
  server.once("error", () => {
    void runtime.close();
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void runtime.close().catch(() => {
        process.exitCode = 1;
      });
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { server, stop };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  startStandaloneApi().catch(() => {
    console.error("standalone_api_start_failed");
    process.exitCode = 1;
  });
