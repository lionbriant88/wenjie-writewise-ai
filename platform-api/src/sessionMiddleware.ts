import type { Request, RequestHandler } from "express";
import type { AuthConfig } from "./config.js";
import { publicUser, type AuthRepository } from "./repository.js";
import { digest, keyedDigest, safeEqual } from "./crypto.js";
import { HttpError, unauthorized } from "./errors.js";

export function createSessionTools(
  repo: AuthRepository,
  config: AuthConfig,
  now: () => Date = () => new Date(),
) {
  const forbidden = () =>
    new HttpError(403, "csrf_invalid", "请刷新页面后重试。");
  const csrf = (value: string) => keyedDigest(config.secret, `csrf:${value}`);
  function requireOrigin(req: Request) {
    if (req.get("origin") !== config.origin) throw forbidden();
  }
  function token(req: Request) {
    const values = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(config.cookieName + "="));
    if (values.length !== 1) throw unauthorized();
    const value = values[0].slice(config.cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw unauthorized();
    return value;
  }
  function authenticatedWrite(req: Request) {
    requireOrigin(req);
    const value = token(req);
    if (!safeEqual(csrf(value), req.get("X-CSRF-Token") ?? ""))
      throw forbidden();
    return value;
  }
  function requireSession(
    options: { teacher?: boolean; write?: boolean; origin?: boolean } = {},
  ): RequestHandler {
    return async (req, res, next) => {
      try {
        if (options.origin) requireOrigin(req);
        const value = options.write ? authenticatedWrite(req) : token(req),
          account = await repo.session(digest(value), now());
        if (!account) throw unauthorized();
        if (options.teacher && account.role !== "teacher")
          throw new HttpError(403, "forbidden", "仅教师账号可操作。");
        res.locals.user = publicUser(account);
        next();
      } catch (error) {
        next(error);
      }
    };
  }
  return { csrf, token, requireOrigin, authenticatedWrite, requireSession };
}
