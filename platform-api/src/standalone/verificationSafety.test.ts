import { expect, it } from "vitest";
import { assertStandaloneVerificationEnvironment } from "../../scripts/verifyStandalonePostgres.js";
const safe = () => ({
  DATABASE_URL:
    "postgres://runtime:synthetic@127.0.0.1:56439/writewise_standalone_012345abcdef",
  DATABASE_ADMIN_URL:
    "postgres://admin:synthetic@127.0.0.1:56439/writewise_standalone_012345abcdef",
  DATABASE_CA_CERT: "synthetic",
  PILOT_VERIFY_EMPTY_DATABASE: "1",
  PILOT_VERIFY_LOCAL_ONLY: "1",
});
it("requires explicit local empty disposable opt-ins before opening any connection", () => {
  expect(() => assertStandaloneVerificationEnvironment(safe())).not.toThrow();
  for (const key of [
    "PILOT_VERIFY_EMPTY_DATABASE",
    "PILOT_VERIFY_LOCAL_ONLY",
    "DATABASE_CA_CERT",
  ])
    expect(() =>
      assertStandaloneVerificationEnvironment({ ...safe(), [key]: undefined }),
    ).toThrow();
  for (const url of [
    "postgres://a:b@example.test:5432/writewise_standalone_012345abcdef",
    "postgres://a:b@127.0.0.1:56439/restored_production",
    "postgres://a:b@localhost:56439/writewise_standalone_012345abcdef",
  ])
    expect(() =>
      assertStandaloneVerificationEnvironment({ ...safe(), DATABASE_URL: url }),
    ).toThrow();
  expect(() =>
    assertStandaloneVerificationEnvironment({
      ...safe(),
      DATABASE_ADMIN_URL: safe().DATABASE_ADMIN_URL.replace(
        "012345abcdef",
        "abcdef012345",
      ),
    }),
  ).toThrow(/mismatch/);
});
it("refuses every real model environment including inherited credentials", () => {
  for (const key of [
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "KIMI_API_KEY",
    "MOONSHOT_API_KEY",
    "ANTHROPIC_API_KEY",
    "GRADING_PROVIDER",
  ])
    expect(() =>
      assertStandaloneVerificationEnvironment({ ...safe(), [key]: "present" }),
    ).toThrow(/model_environment_forbidden/);
});
