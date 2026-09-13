export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
  }
}
export const unauthorized = () =>
  new HttpError(401, "unauthenticated", "请登录后继续。");
export const invalidLogin = () =>
  new HttpError(401, "invalid_credentials", "账号或密码不正确，或账号已停用。");
export const limited = () =>
  new HttpError(429, "rate_limited", "尝试次数较多，请稍后再试。");
