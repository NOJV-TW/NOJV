# Identity hardening: provider-only login, contact-only email

## Goal and approved behavior

The login identity of an account is exactly its linked OAuth provider accounts.
`User.email` never selects, merges, or creates an account, and is immutable after
signup. Notifications may go to a separately verified notification address.
School verification records the proving address. No existing account loses a
login method, a username, or a course binding, and nobody re-verifies.

## Why

- better-auth's OAuth sign-in falls back to `User.email` when the provider account
  is unknown and, for `trustedProviders`, silently links the new provider identity
  to that user. 106 of 168 production accounts use a school address as
  `User.email`; a recycled school mailbox therefore logs the next student into the
  previous owner's account.
- `changeEmail` moves that same login key, so it was an arbitrary-email sign-in
  method in disguise. Its confirmation goes to the old mailbox, its collision with
  an existing account is a silent success, and mailer failures are swallowed —
  the reported "no email arrived" cases.
- `User.email` also receives the security-setup and super-admin recovery OTPs, so it
  must stay bound to the OAuth-proven signup address rather than become a freely
  editable notification field.

## Scope

- `account.accountLinking.disableImplicitLinking: true`; `onAPIError.errorURL` and
  `errorCallbackURL` land every OAuth error on `/signin`, which explains
  `account_not_linked` and points to settings → sign-in methods.
- Remove `user.changeEmail`, the settings action, form, schema, and messages.
- `NotificationPreference.email` / `emailVerifiedAt`: link-verified inside the
  notification preferences dialog, next to the toggles, no step-up. Notification delivery uses it when verified, else
  `User.email`.
- `User.schoolEmail` / `schoolVerifiedAt` and `SchoolVerificationToken.email`:
  audit record written by explicit verification. Informational only —
  `isSchoolVerified` keeps deriving from the username so the 41 verified accounts
  whose primary email is not a school address stay verified.
- Docs: SECURITY (retract "auto-linking by email is safe"), PRODUCT_SENSE,
  THREAT_MODEL (recycled-address story), DATABASE, FRONTEND.

## Production audit (read-only, 2026-09-18)

| Check                                                       | Result | Consequence                                      |
| ----------------------------------------------------------- | ------ | ------------------------------------------------ |
| Active users with no `Account` row                          | 0      | Disabling implicit linking locks nobody out      |
| Active users with only a `credential` account               | 1      | Super admin; unaffected                          |
| Student-ID usernames                                        | 140    | School bindings to preserve                      |
| …whose `User.email` local part equals the ID, school domain | 99     | `schoolEmail` backfilled from `User.email`       |
| …whose school `User.email` names a different ID             | 0      | Backfill rule cannot mis-attribute               |
| …whose `User.email` is not a school address                 | 41     | `schoolEmail` stays NULL; no behavior keys on it |
| Memberships with both or neither of `userId`/`pending` set  | 0 / 0  | No roster data movement needed                   |
| Pending rows colliding with an existing username            | 0      |                                                  |
| In-flight `SchoolVerificationToken` rows                    | 0      | Nobody mid-verification                          |
| Users holding several accounts of one provider              | 14     | Already-linked rows are untouched                |

## Migration plan

Single additive migration, expand-only, safe under the running release:

1. `ALTER TABLE "User" ADD COLUMN "schoolEmail" TEXT, ADD COLUMN "schoolVerifiedAt" TIMESTAMP(3)`
2. `ALTER TABLE "SchoolVerificationToken" ADD COLUMN "email" TEXT`
3. `ALTER TABLE "NotificationPreference" ADD COLUMN "email" TEXT, ADD COLUMN "emailVerifiedAt" TIMESTAMP(3)`
4. Backfill `User.schoolEmail = lower(email)` only where the username is a canonical
   student ID and `lower(email)` is `<id>@<matching school domain>` (the 99 rows);
   `schoolVerifiedAt` stays NULL for every backfilled row, meaning "verified before
   the column existed". Idempotent: guarded by `"schoolEmail" IS NULL`.

The previous release's Prisma client selects only the columns it knows, so old web
and worker pods keep working during rollout. Rollback is redeploying the previous
image; the nullable columns are inert.

Accepted window: a `change-email-verification` token issued within 30 minutes
before rollout is still honored by better-auth's `/verify-email`, which does not
consult `changeEmail.enabled`. None were in flight at audit time.

## What users see

- Nobody re-verifies. Every login that worked yesterday works today.
- Signing in with a provider identity that is new to NOJV but shares an email with an
  existing account now stops at `/signin` with instructions instead of merging.
- "Change email" is gone; "Notification email" appears under notifications.

## Milestones

- [x] Schema, migration with backfill, Prisma client, `pnpm db:docs`
- [x] Auth config, `/signin` error surface, removal of changeEmail
- [x] Notification email: domain, settings card, verify page, delivery fallback
- [x] School proof recorded on explicit verification
- [x] Tests: no implicit link on real OAuth callback; notification delivery target;
      verify-link mail; school proof persisted
- [x] Docs aligned; format, lint, typecheck, unit, integration (CI)
- [ ] Release: tag after CI, re-run the audit queries above post-rollout and
      confirm the 99 backfilled rows plus zero login regressions

## Validation

Integration runs in CI against its own database. Post-rollout, repeat the audit
queries read-only and confirm `count(schoolEmail IS NOT NULL) = 99`.

## References

- [Product behavior](../../product/PRODUCT_SENSE.md)
- [Security requirements](../../operations/SECURITY.md)
- [Threat model](../../operations/THREAT_MODEL.md)
- [Database](../../architecture/DATABASE.md)
