import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { AuthConfig } from "./config.js";
import { absoluteMs, publicUser, type AuthRepository } from "./repository.js";
import { digest, keyedDigest, verifyPassword } from "./crypto.js";
import { HttpError, invalidLogin, limited, unauthorized } from "./errors.js";

import { createSessionTools } from "./sessionMiddleware.js";
import { createPilotRouter } from "./pilot/routes.js";
import type { PilotRuntime } from "./pilot/runtime.js";
import { PilotError } from "./pilot/errors.js";
// Shared across apps within an isolate. No waiting list can grow behind costly scrypt.
let activeVerifications = 0;
const dummyHash = `scrypt$32768$8$3$${"0".repeat(32)}$${"0".repeat(128)}`;
const invalid = () => new HttpError(400, "invalid_request", "请求内容无效。");

export interface CreateAppOptions {
  gradingApp?: RequestHandler;
  pilotRuntime?: PilotRuntime;
}
function objectBody(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function createApp(
  repo: AuthRepository,
  config: AuthConfig,
  now: () => Date = () => new Date(),
  options: CreateAppOptions = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  const { csrf, token, requireOrigin, authenticatedWrite, requireSession } =
    createSessionTools(repo, config, now);
  app.use(
    ["/api/grading", "/api/tasks"],
    requireSession({ origin: true }),
    (_req, _res, next) =>
      next(
        new HttpError(
          409,
          "persistent_job_required",
          "请通过任务队列发起批改。",
        ),
      ),
  );
  app.use(
    "/api/pilot",
    (req, res, next) =>
      requireSession({
        teacher: true,
        write: !["GET", "HEAD", "OPTIONS"].includes(req.method),
      })(req, res, next),
    createPilotRouter(options.pilotRuntime),
  );
  app.use(
    [
      "/api/auth/change-password",
      "/api/auth/reset-password",
      "/api/auth/register",
    ],
    (req, _res, next) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        return next(
          new HttpError(403, "operation_not_allowed", "此操作未开放。"),
        );
      next();
    },
  );
  app.use(express.json({ limit: "16kb", strict: true }));
  const cookieOptions = {
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax" as const,
    path: "/",
  };
  function source(req: Request): string {
    const forwarded = config.trustedVercel
      ? req.get("x-vercel-forwarded-for")
      : undefined;
    if (forwarded && isIP(forwarded)) return forwarded;
    return req.socket.remoteAddress ?? "unknown";
  }
  app.post("/api/auth/login", async (req, res) => {
    requireOrigin(req);
    if (
      !objectBody(req.body) ||
      Object.keys(req.body).sort().join(",") !== "password,username" ||
      typeof req.body.username !== "string" ||
      typeof req.body.password !== "string" ||
      !req.body.username.trim() ||
      req.body.username.length > 80 ||
      !req.body.password ||
      req.body.password.length > 256
    )
      throw invalid();
    const username = req.body.username.trim().toLowerCase();
    const currentTime = now();
    if (
      !(await repo.takeRateLimit(
        keyedDigest(config.secret, `account:${username}`),
        keyedDigest(config.secret, `source:${source(req)}`),
        currentTime,
      ))
    )
      throw limited();
    if (activeVerifications >= 2) throw limited();
    activeVerifications++;
    try {
      const account = await repo.findLogin(username);
      const valid = await verifyPassword(
        req.body.password,
        account?.password_hash ?? dummyHash,
      );
      if (!valid || !account || account.status !== "active")
        throw invalidLogin();
      const value = randomBytes(32).toString("base64url");
      const loggedIn = await repo.createSession(
        account.id,
        account.session_version,
        digest(value),
        now(),
      );
      if (!loggedIn) throw invalidLogin();
      // Replace any prior cookie session after successful login to avoid orphan sessions on account switch.
      try {
        const previous = token(req);
        await repo.logout(digest(previous));
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
      }
      res.cookie(config.cookieName, value, {
        ...cookieOptions,
        maxAge: absoluteMs(loggedIn.role),
      });
      res.json({ user: publicUser(loggedIn), csrfToken: csrf(value) });
    } finally {
      activeVerifications--;
    }
  });
  app.get("/api/auth/session", async (req, res) => {
    const value = token(req),
      account = await repo.session(digest(value), now());
    if (!account) throw unauthorized();
    res.json({ user: publicUser(account), csrfToken: csrf(value) });
  });
  app.post("/api/auth/logout", async (req, res) => {
    const value = authenticatedWrite(req);
    if (!(await repo.session(digest(value), now()))) throw unauthorized();
    await repo.logout(digest(value));
    res.clearCookie(config.cookieName, cookieOptions);
    res.status(204).end();
  });
  app.get("/api/admin/accounts", async (req, res) =>
    res.json({ accounts: await repo.listAccounts(digest(token(req)), now()) }),
  );
  app.patch("/api/admin/accounts/:id", async (req, res) => {
    const value = authenticatedWrite(req);
    const account = await repo.session(digest(value), now());
    if (!account) throw unauthorized();
    if (account.role !== "admin")
      throw new HttpError(403, "forbidden", "仅账号管理员可操作。");
    if (
      typeof req.params.id !== "string" ||
      !/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(req.params.id) ||
      !objectBody(req.body) ||
      Object.keys(req.body).length === 0 ||
      Object.keys(req.body).some((k) => !["status", "displayName"].includes(k))
    )
      throw invalid();
    const patch: { status?: "active" | "disabled"; displayName?: string } = {};
    if ("status" in req.body) {
      if (req.body.status !== "active" && req.body.status !== "disabled")
        throw invalid();
      patch.status = req.body.status;
    }
    if ("displayName" in req.body) {
      if (
        typeof req.body.displayName !== "string" ||
        !req.body.displayName.trim() ||
        req.body.displayName.length > 80 ||
        /[\x00-\x1f\x7f]/.test(req.body.displayName)
      )
        throw invalid();
      patch.displayName = req.body.displayName.trim();
    }
    res.json({
      account: await repo.patchAccount(
        digest(value),
        req.params.id,
        patch,
        now(),
      ),
    });
  });
  app.use((_req, _res, next) =>
    next(new HttpError(404, "not_found", "接口不存在。")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      let safe =
        error instanceof PilotError
          ? new HttpError(
              error.status,
              error.code,
              error.status === 404
                ? "记录不存在。"
                : error.status === 409
                  ? "内容已更新或当前状态不支持此操作，请刷新后重试。"
                  : error.status === 400
                    ? "请求内容无效。"
                    : "服务暂不可用，请稍后重试。",
            )
          : error instanceof HttpError
            ? error
            : new HttpError(
                503,
                "service_unavailable",
                "服务暂不可用，请稍后重试。",
              );
      if (objectBody(error) && error.type === "entity.parse.failed")
        safe = invalid();
      if (objectBody(error) && error.type === "entity.too.large")
        safe = new HttpError(413, "request_too_large", "请求内容过大。");
      if (safe.status === 429) res.set("Retry-After", "900");
      if (safe.status === 401 && safe.code === "unauthenticated")
        res.clearCookie(config.cookieName, cookieOptions);
      res
        .status(safe.status)
        .json({ error: { code: safe.code, message: safe.publicMessage } });
    },
  );
  return app;
}
