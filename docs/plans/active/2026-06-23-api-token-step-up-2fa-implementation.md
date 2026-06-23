# API Token Step-Up (TOTP 2FA) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Companion to the design doc `2026-06-23-api-token-step-up-2fa-design.md`.

**Goal:** Gate `/account/api-tokens` behind a fresh-TOTP step-up; make TOTP enrollable by OAuth-only users via better-auth `allowPasswordless`, hardened with email-OTP + session-freshness + a notification email; and extract a provider-agnostic mailer seam (Resend → Gmail later).

**Architecture:** Step-up verification reuses better-auth's `auth.api.verifyTOTP({body:{code}, headers})` (verified to work for an already-authenticated session — pure verify, no side effects, throws 401 on bad code) and records our own Redis sudo marker. Enrollment is **server-mediated** (our `+page.server.ts` actions call `auth.api.enableTwoFactor`/`verifyTOTP` after our gates) so the email-OTP/freshness hardening cannot be bypassed by calling better-auth directly. Email goes through a 3-file `mailer/` seam.

**Tech Stack:** SvelteKit form actions, better-auth 1.6.17 twoFactor plugin, `@nojv/redis` (raw ioredis `set/get/del` + `keys` registry), `rate-limiter-flexible`, Resend, `node:crypto` HMAC (reuse `API_TOKEN_PEPPER`).

**Key facts established by investigation (do not re-litigate):**
- `auth.api.verifyTOTP({ body:{code}, headers: request.headers })` — authed-session step-up works; wrong code throws `APIError` 401; **do not** pass `trustDevice:true`; **do not** roll your own TOTP verify (secret is XChaCha20-Poly1305 encrypted with a key from `BETTER_AUTH_SECRET`).
- better-auth has **no** replay protection within its ±1 step (~30–90s) window → dedupe accepted codes in Redis for true single-use.
- better-auth's built-in `/two-factor/*` rate limit (10s/3) is HTTP-IP-keyed and may **not** apply to direct `auth.api.*` server calls → add our own per-user attempt throttle.
- `allowPasswordless: true` lets OAuth-only users enable; enable returns `{totpURI, backupCodes}` and `twoFactorEnabled` flips true only on the first `verifyTOTP`.
- `event.locals.session.createdAt` is a real `Date`; freshness = `Date.now() - createdAt.getTime() < FRESH_WINDOW`. Do **not** set global `session.freshAge`. Caveat: this measures time-since-login, not last-reauth, so a stale long-lived session must re-login before enrolling.
- api-tokens actions use `withRateLimit` + manual `try/catch (classifyActionError)` which maps **400/403/404 through**; a thrown `ForbiddenError`/`HttpError(…,403)` inside the `try` becomes `fail(403)` — no signature change needed.
- Redis: raw `getRedis().set(key,val,"EX",ttl)` / `get` / `del`; add key factories to `packages/redis/src/keys.ts` (`nojv:` prefix).

**Constants:** `STEPUP_TTL_SECONDS = 600` (10 min), `OTP_TTL_SECONDS = 600`, `OTP_DEDUPE_TTL_SECONDS = 120`, `ENROLL_FRESH_WINDOW_MS = 5 * 60_000`, `OTP_LENGTH = 6`.

---

## Task 1 — Mailer seam (Resend → Gmail later)

**Files:**
- Create: `apps/web/src/lib/server/mailer/types.ts`, `.../mailer/resend.ts`, `.../mailer/index.ts`
- Modify: `apps/web/src/lib/server/env.ts` (add `EMAIL_PROVIDER`)
- Modify: `apps/web/src/lib/server/shared/school-verification.ts` (use `getMailer()`)
- Test: `tests/unit/web/mailer.test.ts`

**Step 1 — failing test** (`tests/unit/web/mailer.test.ts`): mock `getWebEnv` to return `{EMAIL_PROVIDER:"resend", RESEND_API_KEY:"x", EMAIL_FROM_DOMAIN:"e.com"}` and assert `getMailer()` returns an object with a `sendEmail` function; with `RESEND_API_KEY` unset, `getMailer()` (resend arm) throws `/RESEND_API_KEY/`.

**Step 2 — run, expect fail** (module missing): `pnpm vitest run --project unit tests/unit/web/mailer.test.ts`.

**Step 3 — implement.**
- `types.ts`: `export interface SendEmailInput { to: string; subject: string; html: string }` and `export interface Mailer { sendEmail(i: SendEmailInput): Promise<void> }`.
- `resend.ts`: `createResendMailer(): Mailer` — read `getWebEnv()`, throw if `RESEND_API_KEY`/`EMAIL_FROM_DOMAIN` missing, build `from = \`NOJV <noreply@${domain}>\``, `sendEmail` calls `resend.emails.send(...)` and `throw new Error(error.message)` on error.
- `index.ts`: `export function getMailer(): Mailer { switch (getWebEnv().EMAIL_PROVIDER) { case "resend": return createResendMailer() } }` + re-export types.
- `env.ts`: add `EMAIL_PROVIDER: z.enum(["resend","gmail"]).default("resend")` to `webEnvSchema`.

**Step 4 — run, expect pass.**

**Step 5 — refactor `school-verification.ts`:** drop `import { Resend }`; replace the send block with `try { await getMailer().sendEmail({ to: email, subject: "NOJV 學生帳號驗證", html }) } catch (err) { logger.error("email send failed", {err: err instanceof Error ? err.message : String(err)}); return { error: "Failed to send email", status: 500 } } return { success: true }`. Keep reading `env.BETTER_AUTH_URL` for the verify link. Remove the now-dead `RESEND_API_KEY`/`EMAIL_FROM_DOMAIN` guards (moved into the impl).

**Step 6 — verify + commit:** `pnpm vitest run --project unit tests/unit/web/mailer.test.ts` and the existing school-verification test (grep `tests` for it) pass. Commit `feat(mailer): provider-agnostic mailer seam; route school verification through it`.

---

## Task 2 — Redis keys + step-up / OTP helpers

**Files:**
- Modify: `packages/redis/src/keys.ts` (add `apiTokenStepUp`, `twoFactorEnrollOtp`, `twoFactorTotpSeen`)
- Modify: `apps/web/src/lib/server/shared/rate-limiter.ts` (add `otpSendRateLimiter`, `stepUpAttemptRateLimiter`)
- Create: `apps/web/src/lib/server/step-up.ts` (sudo marker + enroll-OTP + TOTP step-up verify, all server-side)
- Test: `tests/unit/web/step-up.test.ts`

**Key factories** (mirror existing `nojv:<ns>:<id>`):
```ts
apiTokenStepUp: (userId: string) => `nojv:apitoken:stepup:${userId}`,
twoFactorEnrollOtp: (userId: string) => `nojv:2fa:enroll-otp:${userId}`,
twoFactorTotpSeen: (userId: string, code: string) => `nojv:2fa:totp-seen:${userId}:${code}`,
```

**`step-up.ts` exports** (use `getRedis()`, `keys`, `createHmac`/`timingSafeEqual`, `getAuth`):
- `otpPepper()` — read `process.env.API_TOKEN_PEPPER`, prod-required ≥32, dev fallback (copy the `apiTokenPepper()` shape from `packages/application/src/api-token/lifecycle.ts`; or export+reuse it — prefer reuse).
- `hashOtp(otp): string` = `createHmac("sha256", otpPepper()).update(otp).digest("base64url")`.
- `generateOtp(): string` = 6 digits from `crypto.randomInt(0, 1_000_000)` zero-padded.
- `storeEnrollOtp(userId, otp)` → `getRedis().set(keys.twoFactorEnrollOtp(userId), hashOtp(otp), "EX", OTP_TTL_SECONDS)`.
- `verifyEnrollOtp(userId, otp): Promise<boolean>` → get stored hash; `timingSafeEqual` against `hashOtp(otp)` (length-guard first); `del` on success (single-use); return bool.
- `markStepUpFresh(userId)` → `set(keys.apiTokenStepUp(userId), "1", "EX", STEPUP_TTL_SECONDS)`.
- `hasFreshStepUp(userId): Promise<boolean>` → `(await get(...)) !== null`.
- `clearStepUp(userId)` → `del(...)`.
- `verifyTotpStepUp(code, headers): Promise<boolean>` — `try { await getAuth().api.verifyTOTP({ body:{code}, headers }); return true } catch { return false }`. (Caller handles dedupe + throttle.)

**TDD:** unit-test the pure pieces with a mocked `@nojv/redis` (`vi.mock` an in-memory store, like `api-token-lifecycle.test.ts`): OTP hash round-trip + single-use `del`, wrong OTP rejected, marker set/has/clear, OTP store TTL arg passed. Mock `getAuth` for `verifyTotpStepUp` true/false. Commit `feat(step-up): redis keys + sudo-marker/enroll-OTP/TOTP-verify helpers`.

**Rate limiters:** `export const otpSendRateLimiter = createRateLimiter("rl:2fa-otp", 3, 600)` and `export const stepUpAttemptRateLimiter = createRateLimiter("rl:stepup", 5, 600)` — consume by `userId`.

---

## Task 3 — Step-up gate on `/account/api-tokens`

**Files:**
- Create: `apps/web/src/routes/(app)/account/api-tokens/verify/+page.server.ts` and `.../verify/+page.svelte`
- Modify: `apps/web/src/routes/(app)/account/api-tokens/+page.server.ts` (load gate + per-action guard)
- Modify: `apps/web/messages/en.json` + `apps/web/messages/zh-TW.json` (step-up strings)
- Test: integration `tests/integration/http/*` if an HTTP harness fits; else a focused unit test of the guard helper.

**Load gate** (after `requireAuth`, before listing):
```ts
if (!event.locals.sessionUser?.twoFactorEnabled)
  redirect(302, "/account/two-factor?returnTo=" + encodeURIComponent("/account/api-tokens"));
if (!(await hasFreshStepUp(actor.userId)))
  redirect(302, "/account/api-tokens/verify");
```

**Per-action guard** — in each of `create/update/rotate/revoke`, **inside the existing `try`**, immediately after `const actor = requireAuth(event)`:
```ts
if (!(await hasFreshStepUp(actor.userId))) throw new ForbiddenError("Step-up verification required.");
```
(`ForbiddenError` is re-exported from `$lib/server/auth`; `classifyActionError` maps 403 → `fail(403)`.)

**Verify route** (`verify/+page.server.ts`): `load` requires auth + `twoFactorEnabled` (else redirect to enroll); single `default` action: rate-limit `stepUpAttemptRateLimiter.consume(userId)` (429→fail); read `code`; dedupe check `keys.twoFactorTotpSeen` (reject reuse); `verifyTotpStepUp(code, event.request.headers)`; on success set seen-key (`EX OTP_DEDUPE_TTL`), `markStepUpFresh(userId)`, `redirect(303, "/account/api-tokens")`; on failure `fail(401,{error})`. `+page.svelte`: copy the code form from `(auth)/admin-signin/+page.svelte` (FormField + one-time-code Input + Button), reuse `m.account_2fa_codeLabel/verify`.

**Commit** `feat(api-tokens): require fresh TOTP step-up to view/mutate tokens`.

---

## Task 4 — `allowPasswordless` + server-mediated hardened enrollment

**Files:**
- Modify: `apps/web/src/lib/auth.server.ts` (`twoFactor({ issuer:"NOJV", allowPasswordless:true })`)
- Modify: `apps/web/src/routes/(app)/account/two-factor/+page.server.ts` (add server actions)
- Modify: `apps/web/src/routes/(app)/account/two-factor/+page.svelte` (drive the new actions)
- Modify: messages (`en.json`/`zh-TW.json`) — OTP step strings, notification copy
- Test: unit test for the action-level gates where feasible (freshness fail, OTP fail) with mocked deps.

**Server-mediated enroll actions** (replaces the client-direct `authClient.twoFactor.enable`):
1. `sendOtp`: require auth; **freshness** `if (Date.now() - event.locals.session.createdAt.getTime() >= ENROLL_FRESH_WINDOW_MS) return fail(403,{needsReauth:true})`; `otpSendRateLimiter.consume(userId)` (429→fail); `const otp = generateOtp(); await storeEnrollOtp(userId, otp); await getMailer().sendEmail({to: email, subject:"NOJV 兩步驟驗證啟用碼", html: buildOtpEmail(otp)})`; return `{sent:true}`.
2. `enable`: require auth; re-check freshness; `if (!(await verifyEnrollOtp(userId, formOtp))) return fail(400,{error:invalidOtp})`; `const res = await getAuth().api.enableTwoFactor({ body:{}, headers: event.request.headers })` (allowPasswordless → no password); return `{ totpURI: res.totpURI, backupCodes: res.backupCodes }`.
3. `verify`: require auth; `try { await getAuth().api.verifyTOTP({ body:{code}, headers }) } catch { return fail(401,{error}) }`; on success 2FA is now active → `await getMailer().sendEmail({to: email, subject:"NOJV 已啟用兩步驟驗證", html: buildEnabledNotice()})`; return `{enabled:true}`.

**`+page.svelte` flow:** step state machine `idle → otpSent → setup(QR+backupCodes) → done`. Each transition posts to the matching action (use `use:enhance`). Force backup-code acknowledgement (checkbox) before showing the TOTP verify input. Keep `disable`/`generateBackupCodes` — optionally gate them behind step-up later (out of scope v1).

**Commit** `feat(2fa): passwordless TOTP enrollment hardened with email OTP + session freshness + notification`.

---

## Task 5 — Docs + full verification

- `.env.example`: add `EMAIL_PROVIDER=resend` under `# Email`.
- `docs/operations/DEPLOYMENT.md` + `docs/runbooks/getting-started.md`: note `EMAIL_PROVIDER` (default resend).
- Update the design doc's "Open implementation risk" section: spike resolved — `auth.api.verifyTOTP` works for authed sessions (cite verify-two-factor.mjs).
- Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm format` — all green.
- Commit `docs(2fa): env + deployment notes; resolve verify-totp spike in design`.

---

## Risks / watch-items (from investigation)
- **Redis fail-closed:** `hasFreshStepUp` and the rate limiters fail closed → a Redis outage blocks all token management + OTP sends. Consistent with exam/page-lock gates; confirm acceptable.
- **Freshness UX:** a long-lived session is "stale" forever → users may need to re-login before enrolling. Surface a clear "please sign in again" on `needsReauth`.
- **Pepper choice:** reuse `API_TOKEN_PEPPER` for OTP hashing (no new required env) vs a dedicated secret — reuse chosen for ops simplicity.
- **Two better-auth versions in store (1.6.13/1.6.17):** web targets ^1.6.17; the resolved version is 1.6.17 (confirmed). Re-confirm if lockfile changes.
- **Don't** add a step-up field to `sessionUserSchema` (ephemeral per-session state lives in Redis).
- **Verify route must not self-gate** (no step-up check on the verify page → avoid redirect loop); it only requires auth + `twoFactorEnabled`.
