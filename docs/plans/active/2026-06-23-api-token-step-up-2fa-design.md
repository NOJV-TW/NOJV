# API Token Step-Up Authentication (TOTP 2FA) — Design

## Summary

Gate the `/account/api-tokens` management surface behind a GitHub-sudo-mode-style
step-up: a freshly verified TOTP code is required before viewing or mutating API
tokens, even when the browser session is already authenticated.

Because the user base is OAuth-only (GitHub/Google, no credential password for
students), enrollment uses better-auth's `allowPasswordless` path, and the
trust-bootstrap for enabling/changing 2FA is anchored in the verified email
rather than a password.

This is a follow-up to the API token feature (PR #157) and ships as its own PR.

## Key Decisions (validated)

- **Day-to-day step-up = TOTP** (authenticator app), the recognizable / "proper"
  2FA flow. Not email OTP, not password.
- **Unenrolled users are forced to enroll** TOTP before they can manage tokens.
  Once everyone who manages tokens has real 2FA, the gate is uniform.
- **Enrollment / 2FA-change is hardened** because `allowPasswordless` otherwise
  lets any already-authenticated session enable 2FA with no extra proof. v1
  includes all three:
  1. **Email OTP** required to enable or change 2FA.
  2. **Fresh-session check** (better-auth `freshAge` / `session.createdAt`) on the
     enroll path — a stale stolen cookie cannot enroll without a fresh login.
  3. **Notification email** sent whenever 2FA is enabled (detection backstop).
- **Recovery** via better-auth backup codes, surfaced at enrollment.
- **Trust model**: email bootstraps trust; TOTP carries it day-to-day.

## Threat Model

| Threat | Mitigation |
| --- | --- |
| Stolen session mints a long-lived API token | Step-up requires a fresh TOTP code (Redis sudo window, short TTL) before any token view/mutation |
| Stolen session self-enrolls attacker's authenticator, then passes step-up | Enroll requires email OTP + fresh session; enrollment notification email lets the victim notice and revoke |
| Stolen long-lived cookie | `freshAge` blocks enrollment unless the session was created recently (forces a real IdP re-login) |
| Residual: attacker controls **both** session and email | Out of scope — fundamental bootstrap limit shared by all account-recovery designs |

## Components

### 1. Hardened passwordless TOTP enrollment

- `apps/web/src/lib/auth.server.ts`: `twoFactor({ issuer: "NOJV", allowPasswordless: true })`.
- New enroll flow under `/account/two-factor` (extend existing page; keep the
  password path for credential/staff accounts, add the passwordless path):
  1. User requests "enable 2FA".
  2. Server checks session freshness (reject if `now - session.createdAt > FRESH_AGE`,
     prompting a re-login).
  3. Server sends a 6-digit **email OTP** (Resend, reuse `school-verification.ts`
     pattern) and stores it hashed in Redis with TTL.
  4. User enters the email OTP → verified.
  5. Server calls better-auth `enable` (passwordless) → returns `totpURI` + backup codes.
  6. User scans QR, enters first TOTP code → `verifyTotp` confirms → 2FA enabled.
  7. Server sends a **"2FA was enabled"** notification email.
- Same email-OTP + fresh-session gate applies to **disabling / regenerating** 2FA.

### 2. Step-up gate on `/account/api-tokens`

- Redis sudo marker `apitoken:stepup:<userId>` with TTL = `STEPUP_TTL`.
- `+page.server.ts` `load`:
  - If user has no 2FA enrolled → redirect to `/account/two-factor` (enroll first).
  - Else if no fresh sudo marker → redirect to a step-up verify view.
- Step-up verify view: user enters a TOTP code → `verifyTotp` → on success, set the
  Redis marker → redirect back to `/account/api-tokens`.
- **Every** token action (`create` / `update` / `rotate` / `revoke`) re-checks the
  marker server-side (defense in depth; `load` redirect alone is bypassable by a
  direct POST). Missing/expired marker → 403.

### 3. Recovery

- Backup codes shown once at enrollment (better-auth provides them).
- A backup code is accepted in the step-up verify view as a TOTP alternative
  (covers lost-phone lockout of token management).

## Redis keys

| Key | Purpose | TTL |
| --- | --- | --- |
| `apitoken:stepup:<userId>` | Fresh-step-up sudo window | `STEPUP_TTL` (default 10 min) |
| `2fa:enroll-otp:<userId>` | Hashed email OTP for enroll/change | `OTP_TTL` (default 10 min) |

## Defaults (adjustable at review)

- `STEPUP_TTL` = 10 minutes.
- `OTP_TTL` = 10 minutes; OTP = 6 digits, single-use, rate-limited via the existing
  cooldown/rate-limiter (e.g. 1 send / 60s, N sends / hour).
- `FRESH_AGE` for enrollment = 5 minutes since `session.createdAt`.
- Gate covers both **view and mutations**.

## Open implementation risk (spike first)

- **Does `twoFactor.verifyTotp` work for an already-fully-authenticated session**
  (no pending sign-in 2FA challenge)? The plugin's primary use is completing the
  sign-in challenge. Step-1 of implementation is a spike:
  - If yes → use it directly for step-up.
  - If it requires a pending challenge / different entry point → verify the
    submitted code server-side against the enrolled secret, or trigger a
    lightweight challenge. Resolve before building the gate UI.

## Out of scope (v1)

- WebAuthn / passkeys as a second factor.
- Per-token step-up (one sudo window covers the whole management page).
- Step-up on any surface other than `/account/api-tokens`.
- Requiring step-up to *use* a token (tokens are bearer creds by design; step-up
  guards *minting/managing*, not API calls).

## Test plan

- Enroll: fresh-session required; email OTP required and single-use/expiring;
  enable succeeds passwordless for an OAuth account; notification email sent.
- Step-up: unenrolled user redirected to enroll; enrolled user without marker
  redirected to verify; valid TOTP sets marker; expired marker re-prompts.
- Actions: each token action 403s without a fresh marker (direct-POST bypass
  attempt); succeeds with one.
- Recovery: backup code accepted at step-up.
- Negative: wrong/expired TOTP and wrong/expired email OTP rejected; rate limit
  enforced.
