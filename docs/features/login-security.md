# Login and Security Verification

## State Model

- A verified TOTP row or passkey is a security factor. Their presence is the only configured-state source of truth.
- Security proofs are bound to the session and current `securityGeneration`; stale or unavailable Redis state fails closed.
- Email OTP can unlock first-factor setup only when no factor exists. Backup codes and recovery email OTP are recovery credentials, not admin second factors.

## Security Settings

- Given no factor, when the user verifies the account email OTP, then security settings are unlocked for ten minutes.
- Given an existing factor, when the user verifies TOTP or passkey, then settings are unlocked for ten minutes.
- While unlocked, the user may add, replace, or remove factors and regenerate backup codes without entering a password or another identity code. Each mutation rebinds the remaining window to the new generation.
- TOTP replacement keeps the old factor until the code from the new QR succeeds, then commits the encrypted secret and backup codes atomically.
- A regular account may remove its final factor. A super admin cannot remove its final factor through either UI or server calls.

## Admin Access

- A regular admin signs in with existing supported methods but remains an effective student until entering admin mode. Fresh TOTP/passkey proof permits entry and re-entry for ten minutes; active admin mode lasts at most seven days.
- Leaving regular admin mode removes admin access but preserves the unexpired ten-minute proof.
- A super admin signs in with a credential password and then TOTP or passkey. Success grants admin access directly and follows a same-origin `returnTo`, defaulting to `/admin`.
- Super-admin OAuth sign-in/linking, passwordless passkey sign-in, and `/api/admin-mode` are rejected. Session rotation cannot extend the 24-hour limit measured from password authentication.

## First Login and Recovery

- A pending super admin follows one `/admin-signin` flow: temporary password, new password, factor choice, factor confirmation, `/admin`. The temporary password may remain in page memory during the uninterrupted flow but is never persisted across refresh.
- Until password change and session MFA are complete, super-admin page requests are redirected to the sign-in flow and API requests return 403.
- Recovery verifies password first, then accepts one backup code or email OTP. It revokes other sessions, removes old factors, and grants setup-only access.
- Recovery authority cannot access admin routes. Confirming a new TOTP or passkey is required before super-admin MFA and admin access are restored.

## Verification

- Unit coverage owns factor-derived state, ten-minute TTL, generation invalidation, final-factor enforcement, and regular/super access resolution.
- Integration coverage owns pending-TOTP replacement, passkey gates, OAuth/passwordless blocking, recovery authority, Redis failure, and concurrent removal.
- E2E coverage owns first and later super-admin login, regular-admin re-entry, TOTP copy, final-factor UX, recovery, and expiry behavior.
