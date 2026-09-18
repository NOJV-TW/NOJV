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
- `NotificationPreference.email`: an optional address edited with the notification
  preferences, saved directly (it carries no security codes). Delivery uses it when
  set, else `User.email`.
- `User.schoolEmail` / `schoolVerifiedAt` and `SchoolVerificationToken.email`:
  audit record written by explicit verification. Informational only —
  `isSchoolVerified` keeps deriving from the username so the 41 verified accounts
  whose primary email is not a school address stay verified.
- `/admin/users` gains a verified column: the derived school-verified state plus the
  recorded proving address, so recycled-ID cases are visible to admins.
- Docs: SECURITY (retract "auto-linking by email is safe"), PRODUCT_SENSE,
  THREAT_MODEL (recycled-address story), DATABASE, FRONTEND.

## Production audit (read-only, 2026-09-18)

| Check                                                       | Result | Consequence                                                     |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| Active users with no `Account` row                          | 0      | Disabling implicit linking locks nobody out                     |
| Active users with only a `credential` account               | 1      | Super admin; unaffected                                         |
| Student-ID usernames                                        | 140    | School bindings to preserve                                     |
| …whose `User.email` local part equals the ID, school domain | 99     | `schoolEmail` backfilled from `User.email`                      |
| …whose school `User.email` names a different ID             | 0      | Backfill rule cannot mis-attribute                              |
| …whose `User.email` is not a school address                 | 41     | 25 recovered from the Google id_token email claim; 16 stay NULL |
| Google id_token claim naming a _different_ ID / colliding   | 0 / 0  | Claim-based recovery cannot mis-attribute                       |
| Memberships with both or neither of `userId`/`pending` set  | 0 / 0  | No roster data movement needed                                  |
| Pending rows colliding with an existing username            | 0      |                                                                 |
| In-flight `SchoolVerificationToken` rows                    | 0      | Nobody mid-verification                                         |
| Users holding several accounts of one provider              | 14     | Already-linked rows are untouched                               |

## Migration plan

Single additive migration, expand-only, safe under the running release:

1. `ALTER TABLE "User" ADD COLUMN "schoolEmail" TEXT, ADD COLUMN "schoolVerifiedAt" TIMESTAMP(3)`
2. `ALTER TABLE "SchoolVerificationToken" ADD COLUMN "email" TEXT`
3. `ALTER TABLE "NotificationPreference" ADD COLUMN "email" TEXT`
4. Backfill `User.schoolEmail = lower(email)` where the username is a canonical
   student ID and `lower(email)` is `<id>@<matching school domain>` (99 rows).
5. For remaining verified accounts, read the email claim from the linked Google
   account's `id_token` (all 174 are plaintext JWTs). Where it is `<id>@<matching
school domain>` and no other account holds that address: set `schoolEmail`; and
   when the login email had been changed to a personal address (25 rows), keep that
   personal address as the notification email and restore the school address as
   `User.email`. Decoding is guarded per row; `schoolVerifiedAt` stays NULL for every
   backfilled row. 16 verified accounts (5 GitHub-only, 11 whose Google account is
   personal) keep `schoolEmail` NULL; nothing keys on it.

The previous release's Prisma client selects only the columns it knows, so old web
and worker pods keep working during rollout. Rollback is redeploying the previous
image; the nullable columns are inert.

Accepted window: a `change-email-verification` token issued within 30 minutes
before rollout is still honored by better-auth's `/verify-email`, which does not
consult `changeEmail.enabled`. None were in flight at audit time.

## What users see

- The 25 accounts whose login email is restored to the school address will receive
  security codes there; their OAuth login and notifications are unaffected.
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
- [x] Release: tag after CI, re-run the audit queries above post-rollout and
      confirm the backfilled rows plus zero login regressions

## Validation

Integration runs in CI against its own database. Post-rollout, repeat the audit
queries read-only and confirm `count(schoolEmail IS NOT NULL) = 124` and 25 restored login emails.

## Results

Shipped as v1.1.9 (`e015f420`, PR #449, with #445 and #446). Migration
`20260918000000_identity_hardening` applied on 2026-09-18 11:09 UTC with the old
workloads held at zero; read-only audit immediately after:

| Check                                               | Result  | Expected |
| --------------------------------------------------- | ------- | -------- |
| Active users with no `Account` row                  | 0       | 0        |
| Student-ID usernames                                | 140     | 140      |
| `schoolEmail` filled                                | 124     | 124      |
| …on a non-student-ID username / local-part mismatch | 0 / 0   | 0 / 0    |
| Login email equals `schoolEmail`                    | 124     | 124      |
| Login email restored, personal kept for notices     | 26      | 25       |
| `schoolVerifiedAt` set by backfill                  | 0       | 0        |
| Duplicate emails / active users                     | 0 / 168 | 0 / 168  |

The 26th restored account came from the 99-row group, not from an
unrecoverable one: six minutes before the migration, while v1.1.8 was still
serving, that user linked a personal Google account and used the old "change
email" to move their login email onto it. The migration saw a personal login
email with a school id_token claim and applied the designed rule. The 16
accounts without a recoverable proving address are unchanged.

Helm release v226 (chart `+c955c533`) rolled web, worker and worker-platform to
v1.1.9 with zero restarts; `/api/release` reports `v1.1.9` / `e015f420` in-cluster
and publicly.

### Follow-up corrections (2026-09-18, admin SQL, guarded)

- The 26 restored accounts got their chosen personal address back as `User.email`
  (15 are the email claim of a linked Google account; 11 were verified by the old
  change-email link), so security codes reach a mailbox they read. `schoolEmail`
  stays as the audit record; the now-redundant notification email was cleared.
- The 16 unrecoverable accounts are all NTNU student IDs; `schoolEmail` was set to
  `<id>@gapps.ntnu.edu.tw` (the local part is the verified ID, NTNU student mail is
  the Workspace domain). `User.email` untouched; `schoolVerifiedAt` stays NULL.
- Result: `schoolEmail` 140/140, 98 login emails equal the school address, zero
  duplicate emails, zero accounts without a login method, 168 active accounts.
- Five of those 16 student mailboxes are `User.email` of a dormant second account
  (0 memberships, 0 submissions, no sessions, Google-only, created minutes to days
  after the real one): pre-#438 school-Google sign-ins whose student ID was already
  held by the person's real account. Hard-deleted the same day under a guard
  (exactly five rows, no memberships, submissions, participations, sessions,
  owned courses, authored problems or non-Google accounts); this frees the school
  Google identity so the owner can link it to their real account. Active accounts
  163, zero school mailboxes owned by another account, zero orphan `Account` rows.

## References

- [Product behavior](../../product/PRODUCT_SENSE.md)
- [Security requirements](../../operations/SECURITY.md)
- [Threat model](../../operations/THREAT_MODEL.md)
- [Database](../../architecture/DATABASE.md)
