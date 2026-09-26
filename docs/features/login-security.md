# Feature: Login and Security Verification

Acceptance spec for security factors, the security-settings unlock, admin mode and super-admin first login and recovery. Decisions: SEC-04 (step-up uses an enrolled factor; MFA state derives from factors), SEC-05 (admin elevation, stricter super-admin login). Threats and controls: [Security](../operations/SECURITY.md).

## Key code

- `packages/application/src/api-token/step-up.ts` — proof, admin-mode and super-admin TTLs, session markers
- `packages/application/src/api-token/security-settings.ts` — factor mutations and the settings unlock
- `apps/web/src/lib/server/step-up.ts`, `step-up-handoff.ts`, `totp-enrollment.ts`, `admin-signin-state.ts`, `super-admin-password-proof.ts`, `passkey-request-proof.ts`
- Routes: `apps/web/src/routes/(auth)/admin-signin/`, `apps/web/src/routes/(app)/settings/`

## State model

- A verified TOTP row or a passkey is a security factor; their presence is the only source of configured state.
- Security proofs are bound to the session and the current `securityGeneration`; stale or unavailable Redis state fails closed.
- Email OTP unlocks first-factor setup only when no factor exists. Backup codes and recovery email OTP are recovery credentials, never admin second factors.

## Acceptance criteria

### Security settings

- No factor: verifying the account email OTP unlocks security settings for 10 minutes.
- Existing factor: verifying TOTP or a passkey unlocks settings for 10 minutes.
- While unlocked, the user may add, replace or remove factors and regenerate backup codes without a password or another code. Each mutation rebinds the remaining window to the new generation.
- TOTP replacement keeps the old factor until a code from the new QR succeeds, then commits the encrypted secret and backup codes atomically.
- A regular account may remove its last factor; a super admin cannot, through the UI or server calls.

### Admin access

- A regular admin signs in normally and stays an effective student until entering admin mode. A fresh TOTP/passkey proof allows entry and re-entry for 10 minutes; admin mode lasts at most 7 days. Leaving admin mode keeps the unexpired proof.
- A super admin signs in with the credential password and then TOTP or passkey, gets admin access directly, and follows a same-origin `returnTo` (default `/admin`).
- Super-admin OAuth sign-in or linking, passwordless passkey sign-in and `/api/admin-mode` are rejected. Session rotation cannot extend the 24-hour limit measured from password authentication.

### First login and recovery

- A pending super admin follows one `/admin-signin` flow: temporary password, new password, factor choice, factor confirmation, `/admin`. The temporary password may stay in page memory during the flow but is never persisted across refresh.
- Until the password is changed and session MFA completes, super-admin page requests redirect to that flow and API requests return 403.
- Recovery verifies the password first, then one backup code or email OTP. It revokes other sessions, removes old factors and grants setup-only access, which cannot reach admin routes. Confirming a new TOTP or passkey restores super-admin MFA and admin access.

## Test ownership

- Unit: factor-derived state, 10-minute TTL, generation invalidation, final-factor rule, regular/super access resolution.
- Integration: pending-TOTP replacement, passkey gates, OAuth/passwordless blocking, recovery authority, Redis failure, concurrent removal.
- E2E: first and later super-admin login, regular-admin re-entry, TOTP copy, final-factor UX, recovery, expiry.
