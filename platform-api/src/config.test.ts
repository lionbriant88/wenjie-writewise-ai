import { expect, it } from "vitest";
import { readConfig } from "./config.js";
const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://runtime:synthetic@db.invalid:5432/postgres",
  APP_ORIGIN: "https://school.example",
  AUTH_RATE_LIMIT_SECRET: "s".repeat(40),
};
it("fails closed for missing secrets, non-HTTPS production and local mode on Vercel", () => {
  for (const field of ["DATABASE_URL", "APP_ORIGIN", "AUTH_RATE_LIMIT_SECRET"])
    expect(() => readConfig({ ...valid, [field]: "" })).toThrow();
  expect(() =>
    readConfig({ ...valid, APP_ORIGIN: "http://localhost:5173" }),
  ).toThrow();
  expect(() => readConfig({ ...valid, AUTH_STORAGE: "local" })).toThrow();
  expect(() =>
    readConfig({
      ...valid,
      NODE_ENV: "development",
      VERCEL: "1",
      AUTH_STORAGE: "local",
    }),
  ).toThrow();
  expect(() =>
    readConfig({ ...valid, APP_ORIGIN: "https://school.example/path" }),
  ).toThrow();
});
it("uses host-only secure cookie in HTTPS and separate cookie for explicit loopback development", () => {
  expect(readConfig(valid)).toMatchObject({
    cookieName: "__Host-wj_session",
    secure: true,
    storage: "postgres",
  });
  expect(
    readConfig({
      NODE_ENV: "development",
      AUTH_STORAGE: "local",
      AUTH_LOCAL_PATH: "local-auth-data",
      APP_ORIGIN: "http://127.0.0.1:5173",
      AUTH_RATE_LIMIT_SECRET: "x".repeat(40),
    }),
  ).toMatchObject({
    cookieName: "wj_dev_session",
    secure: false,
    storage: "local",
  });
  expect(() =>
    readConfig({
      NODE_ENV: "development",
      AUTH_STORAGE: "local",
      AUTH_LOCAL_PATH: "x",
      APP_ORIGIN: "http://0.0.0.0:5173",
      AUTH_RATE_LIMIT_SECRET: "x".repeat(40),
    }),
  ).toThrow();
});
