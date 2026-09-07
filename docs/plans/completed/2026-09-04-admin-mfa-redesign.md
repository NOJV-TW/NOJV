# Admin and Super Admin MFA Redesign

## Problem

The independent 2FA switch disagrees with the actual TOTP and passkey state, factor
management repeats verification inside one task, and super admins follow the regular
admin sudo flow even though their sessions require a stronger login contract.

## Constraints

- Security-factor presence is the only configured-state source of truth.
- Strong verification unlocks security settings for 10 minutes and is bound to the
  session and current `securityGeneration`.
- Regular admins retain explicit admin mode; verified super-admin sessions receive
  admin access directly and expire after 24 hours.
- Backup codes and email OTP grant recovery or setup only, never admin access.
- Existing Better Auth TOTP, backup-code, password, and WebAuthn capabilities remain
  authoritative; no compatibility layer or new table is added.

## Milestones

- [x] Replace the activation switch with factor-derived state and generation-bound
      Redis grants.
- [x] Make TOTP replacement atomic by staging encrypted enrollment material in Redis.
- [x] Separate regular-admin mode from super-admin session MFA and block super-admin
      OAuth or passwordless passkey entry.
- [x] Build the password, password-change, factor setup, verification, and recovery
      state machine on `/admin-signin`.
- [x] Replace settings UI and copy with the unified "登入與安全驗證" model.
- [x] Remove `twoFactorActivated`, rename admin-access state, update security docs,
      and verify unit, integration, E2E, and `pnpm ci:verify`.

## Risks

- Session rotation during passkey verification must preserve the original super-admin
  authentication time.
- Concurrent removal of different factors must not remove a super admin's final factor.
- Redis errors on privileged paths must fail closed without destroying an existing
  factor.

## Living Documents

- [Security Requirements](../../operations/SECURITY.md)
- [Threat Model](../../operations/THREAT_MODEL.md)
- [Database Schema](../../architecture/DATABASE.md)
- [Frontend Surface](../../architecture/FRONTEND.md)
