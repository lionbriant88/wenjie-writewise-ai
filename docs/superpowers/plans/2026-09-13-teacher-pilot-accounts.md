# Teacher Pilot Accounts Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Deliver deployable fixed-password teacher authentication and a repeatable 30-account initializer before cloud projects exist.
**Architecture:** Vercel React + Node same-origin BFF with opaque sessions; Supabase PostgreSQL via a restricted runtime role. PGlite runs the same SQL in local integration tests. Account access is deployable independently; grading endpoints remain closed until the separate durable workload integration.
**Tech Stack:** Node 24, TypeScript, Express, pg, PGlite, Vitest/Supertest, existing React/Vite.
**Spec:** ../specs/2026-09-13-teacher-pilot-accounts-design.md

## Global Constraints

- 30 teacher accounts plus one independent admin, immutable user-requested initial password; read the password from explicit environment during prepare, never hardcode it into production source or print it.
- No registration/change/reset password, neither UI nor API; login is server-side and never issues Supabase Auth credentials.
- Persist accounts/sessions/rate limits in PostgreSQL, with isolated local PGlite verification; production rejects local mode/missing configuration.
- No cloud project creation, real model calls, OCR startup, production secrets, or teacher/student data.
- Grading is closed on this deployable account release; retain original business UI only in explicitly selected development demo mode.
- Worktree: D:/wenjie-writewise-ai/.worktrees/codex-teacher-pilot-accounts; base 5c8352f. Keep main and the optimization worktree intact.

## Task 1: Persistent authentication, account management and initializer

**Files:** Create `platform-api/package.json`, `tsconfig.json`, `.env.example`, `src/config.ts`, `src/crypto.ts`, `src/database.ts`, `src/repository.ts`, `src/server.ts`, `src/runtime.ts`, `src/vercel.ts`, `src/index.ts`, `src/migrations/001_pilot_auth.sql`, `scripts/accounts.ts`, focused tests under `src/` and `scripts/`. Split modules further where needed, without changing other packages.

**Interfaces:** HTTP contracts are exactly those in the spec. Export a default Node/Vercel handler from `src/vercel.ts` and named async `getRuntimeApp()` from `src/runtime.ts`. Package commands `test`, `typecheck`, `dev`, `accounts:prepare`, `accounts:apply`, `db:migrate`. Runtime environment `DATABASE_URL`, `APP_ORIGIN`, `AUTH_RATE_LIMIT_SECRET`, optional `DATABASE_CA_CERT`, local-only `AUTH_STORAGE=local`, `AUTH_LOCAL_PATH`, `PORT`. CLI uses `DATABASE_ADMIN_URL` for migrations/apply, `PILOT_INITIAL_PASSWORD` for prepare; no automatic .env from other packages.

- [x] Set up package/test tooling; write integration tests against real SQL: apply same batch twice, 30 teachers/1 admin, unique usernames and salted hashes, immutable password trigger, denied public schema access. Run RED; fail for missing behavior, not missing test runner.
- [x] Implement DB/query adapters for pg and PGlite; migrations in private schema; bounded pg pool, safe SSL settings and no named prepared statements. Run identical repository queries in PGlite tests.
- [x] Write auth HTTP tests (Supertest) using actual hash/store: success/invalid login, no password in response, secure cookies, session replay after a new app instance, expiration, forged Origin/CSRF, no password/register route, admin vs teacher, disabled-session revocation, race-safe login/disable, last-admin protection, rate limit across two app instances. Observe RED then implement and pass.
- [x] Initializer prepare/apply tests use an ignored temporary directory, a synthetic password environment and fresh DB; assert counts from SQL and real password verification. An existing output must not be overwritten; different manifest for same batch must fail before mutating rows; transactional failure leaves no partial batch. Write prepare/apply and migration commands, validate strict manifest and atomic/serialized batch application.
- [x] `npm.cmd test` and `npm.cmd run typecheck` in platform-api. Log commands/counts and self-review in the task report. Do not commit shared changes; controller will package reviewed work.

Example expected consumer behavior:

```ts
const login = await request(app).post('/api/auth/login')
  .set('Origin', origin).send({ username: teacher.username, password: syntheticPassword })
expect(login.status).toBe(200)
expect(login.body.user.role).toBe('teacher')
const forbidden = await request(app).post('/api/auth/change-password')
  .set('Origin', origin).set('Cookie', login.headers['set-cookie'])
  .set('X-CSRF-Token', login.body.csrfToken).send({ password: 'replacement' })
expect(forbidden.status).toBe(403)
```

## Task 2: Login and account management UI

**Files:** Create `app/src/auth/types.ts`, `client.ts`, `AuthProvider.tsx`, `AccountApp.tsx`, tests; add login/account/admin UI files under that module. Modify `app/src/App.tsx`, `app/vite.config.ts`, `app/.env.example`. Preserve original business routes in a separate local-demo component if useful. Do not edit AppState domain or Gateway.

**Interfaces:** HTTP and PublicUser shape in spec. Default fetch credentials same-origin. GET session/login returns `{user,csrfToken}`, admin list `{accounts}`, PATCH `{account}`; `X-CSRF-Token` for authenticated mutations. No localStorage auth token. Missing/503 API shows unavailable and retry. Root can start API at 127.0.0.1:8793, Vite dev proxy `/api` to that address.

- [x] Write meaningful Testing Library RED tests: anonymous cannot view account/admin, successful login shows own display name, no password field auto-fill, teacher does not fetch/list admin accounts, error/expired session clears private content, login response after logout is ignored.
- [x] Implement gate: production always AccountApp; local old app only when DEV and `VITE_AUTH_MODE=local-demo`. Account ready screen shows batch testing wait state and logout; admin view lists searchable accounts with display-name edits and enable/disable buttons, never edit passwords or roles.
- [x] Test admin CSRF header, successful/failed update feedback, disabled account UX, broadcast logout/focus session revalidation and out-of-order session responses. Implement cancellation/generation binding; remove all listeners on unmount.
- [x] Run focused UI tests, typecheck, lint/build. Append exact evidence to task report. Controller performs real browser validation and combined checks.

```tsx
expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
await user.type(screen.getByLabelText('账号'), 'wj_example')
await user.type(screen.getByLabelText('密码'), 'synthetic-password')
await user.click(screen.getByRole('button', { name: '登录' }))
expect(await screen.findByText('账号已就绪')).toBeVisible()
expect(screen.queryByRole('button', { name: '修改密码' })).not.toBeInTheDocument()
```

## Task 3: Deployment package, local acceptance and documentation

**Files:** Create repo `package.json` and lock for deployment if needed, `vercel.json`, `api/index.ts`, `docs/teacher-pilot-accounts-setup.md`; modify `.gitignore`, AGENTS/current status and implementation ledger.

**Interfaces:** root API reexports `platform-api/src/vercel.ts`. `vercel.json` builds app to `app/dist`, uses Node serverless API, routes `/api/*` before SPA fallback and preserves static assets. Install both packages from their lockfiles; no VITE secret settings. Max duration for auth 15 seconds, no 360s inference in auth function.

- [x] Create root deployment config and install/build commands; typecheck the root API entry against the platform package. Verify `/api` errors are JSON and deep-link SPA routing remains valid.
- [x] Run prepare into ignored directory, migrate/apply to explicit local PGlite, replay batch, then verify all 31 logins and no password mutation. Store private artifacts outside tracked files; only counts in logs.
- [x] Start local API + app on free loopback ports hidden, exercise teacher/admin login/logout, edit display-name, disable/enable teacher, direct forbidden password API, refresh and second tab; inspect desktop/mobile screenshots in Codex browser.
- [x] Run app full tests (maxWorkers=2), app typecheck/lint/build, API tests/typecheck and git diff checks. Generate review package from base to current changes; independent reviewer assesses spec and quality before completion.
- [x] Explain exact Supabase project/role/migrate/apply and Vercel env/root-dir/build steps with no actual secrets. Mark local credentials vs pending Supabase creation/deployment and OpenRouter work truthfully. Keep private account usernames/passwords out of docs and git.

## Progress

No cloud projects exist; user expressly authorized code and initialization tools now. No further design permission is required for this revised scope.
