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
import { digest, keyedDigest, safeEqual, verifyPassword } from "./crypto.js";
import { HttpError, invalidLogin, limited, unauthorized } from "./errors.js";

// Shared across apps within an isolate. No waiting list can grow behind costly scrypt.
let activeVerifications = 0;
const dummyHash = `scrypt$32768$8$3$${"0".repeat(32)}$${"0".repeat(128)}`;
const invalid = () => new HttpError(400, "invalid_request", "请求内容无效。");
const forbidden = () =>
  new HttpError(403, "csrf_invalid", "请刷新页面后重试。");

export interface CreateAppOptions {
  gradingApp?: RequestHandler;
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
  async function authenticateGrading(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    try {
      requireOrigin(req);
      const value = token(req);
      if (!(await repo.session(digest(value), now()))) throw unauthorized();
      next();
    } catch (error) {
      next(error);
    }
  }
  if (options.gradingApp) {
    app.use("/api", (req, res, next) => {
      if (!req.path.startsWith("/grading") && !req.path.startsWith("/tasks")) {
        next();
        return;
      }
      authenticateGrading(req, res, (error) => {
        if (error) {
          next(error);
          return;
        }
        options.gradingApp!(req, res, next);
      });
    });
  } else {
    app.use(["/api/grading", "/api/tasks"], (_req, _res, next) =>
      next(
        new HttpError(503, "pilot_grading_not_configured", "作文批改暂未开放。"),
      ),
    );
  }
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
  const csrf = (token: string) => keyedDigest(config.secret, `csrf:${token}`);
  function requireOrigin(req: Request) {
    if (req.get("origin") !== config.origin) throw forbidden();
  }
  function token(req: Request): string {
    const values = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(config.cookieName + "="));
    if (values.length !== 1) throw unauthorized();
    const value = values[0].slice(config.cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw unauthorized();
    return value;
  }
  function authenticatedWrite(req: Request): string {
    requireOrigin(req);
    const value = token(req),
      supplied = req.get("X-CSRF-Token") ?? "";
    if (!safeEqual(csrf(value), supplied)) throw forbidden();
    return value;
  }
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
        error instanceof HttpError
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
