# Authentication and security decisions

Durable decisions for identity, sign-in, MFA and step-up, admin privilege, API tokens, request-boundary hardening, data exposure and Advanced-mode output capture. Sandbox isolation lives in judge.md. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Security](../operations/SECURITY.md) and [Threat Model](../operations/THREAT_MODEL.md).

### SEC-01 Third-party login only; no public sign-up; admins bootstrapped from env

**Decided:** 2026-04 · **Source:** [2026-04-30-functional-gaps](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-30-functional-gaps.md), [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md)

Users sign in with GitHub or Google. Email/password sign-up is disabled everywhere (`disableSignUp: true`); admins are credential accounts created once by `db:bootstrap-admin` from env (all values required in production, password ≥12 chars, never overwritten) and forced through `mustChangePassword`. The demo seed refuses production without `ALLOW_PROD_SEED`. This keeps production credentials out of source and closes open registration.

- Rejected: self-serve password reset; an OAuth allow-list for admins; bulk user/problem import, bulk session release and zip export (unrequested).
- Rule: no public email/password registration or password reset without a product decision.
- Rule: no production credential may be derivable from source or SQL.
- Code: `apps/web/src/lib/auth.server.ts`, `packages/db/prisma/bootstrap-admin.ts`, `packages/db/prisma/seed.ts`

### SEC-02 Provider accounts are the login identity; linking is explicit; `User.email` is the security mailbox

**Decided:** 2026-06 · **Source:** [2026-06-24-passwordless-stepup-2fa](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-24-passwordless-stepup-2fa.md), [2026-09-18-identity-hardening](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-18-identity-hardening.md), [2026-09-08-email-change-review-fixes](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/superpowers/plans/2026-09-08-email-change-review-fixes.md), [2026-07-07-admin-account-ux-overhaul](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-admin-account-ux-overhaul.md)

Implicit email linking is disabled; a signed-in user links GitHub/Google from settings with step-up and a notification. `User.email` never selects, merges or creates an account; it receives only security mail and changes only via the gated `changeSecurityEmail` action confirmed from the current mailbox. School mailboxes are recycled, so email-based linking would hand one student's account to the next.

- Rejected: email-based auto-linking (earlier "safe" claim retracted); account merging (deferred); the old `changeEmail` flow, effectively an arbitrary-email sign-in — replaced by `changeSecurityEmail`.
- Rule: security OTPs and recovery mail go only to `User.email`, never `NotificationPreference.email`.
- Rule: an identity held by another account is blocked; unlinking the last login method is refused; OAuth errors land on `/signin` naming `account_not_linked`/`account_already_linked_to_different_user`.
- Rule: HTML-escape user-controlled addresses in mail; email actions stay behind `withRateLimit`.
- Code: `apps/web/src/lib/auth.server.ts`, `apps/web/src/routes/(app)/settings/+page.server.ts`

### SEC-03 `User.username` is the only handle; only school verification assigns a student ID

**Decided:** 2026-04 · **Source:** [2026-04-16-account-edit-name-username](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-account-edit-name-username.md), [2026-09-15-username-identity-boundary](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-15-username-identity-boundary.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md), [2026-09-18-identity-hardening](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-18-identity-hardening.md)

Onboarding sets a unique general username and rejects reserved student-ID formats; explicit school verification in settings replaces it with the student ID and records `schoolEmail`/`schoolVerifiedAt` as audit. Verified status derives from the username format, so verified users cannot rename. Sign-in, email change and linking never change the username. Email-derived inference had overwritten usernames and broken OAuth callbacks.

- Rejected: a separate `handle` column; inferring usernames from school email; keying verification on `schoolEmail`; email editing here and an "unverify" flow. Earlier: placeholder `pending_first_login` Users for invited handles (2026-04) — replaced by `CourseMembership.pendingUsername`.
- Rule: `isReservedUsername` names are obtainable only through school verification; renaming a verified user throws `VERIFIED_LOCKED`.
- Rule: roster binding happens only by a username the user already owns; membership identity and merge rules are ASM-04 in assessments.md.
- Code: `packages/application/src/user/mutations.ts`, `packages/core/src/reserved-username.ts`, `packages/db/prisma/schema/course.prisma`

### SEC-04 Step-up uses an enrolled factor; MFA state derives from factors

**Decided:** 2026-06 · **Source:** [2026-06-24-passwordless-stepup-2fa](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-24-passwordless-stepup-2fa.md), [2026-06-23-api-token-step-up-2fa-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-23-api-token-step-up-2fa-design.md), [2026-09-04-admin-mfa-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-04-admin-mfa-redesign.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

Sensitive actions are unlocked by the user's own TOTP or passkey, identical for Google and GitHub, with backup codes for recovery. "MFA configured" means a verified factor row exists. Unlocks last ~10 minutes and are bound to the session and `securityGeneration`. Email OTP (sha256, 5 attempts) may unlock only the first setup when no factor exists. GitHub cannot force re-login, and a separate-device factor beats an email open in the same browser.

- Rejected: OAuth `prompt=login` (Google-only); email OTP as everyday step-up; a global `session.freshAge`; a `twoFactorActivated` switch that drifted from real factors. Earlier: peppered email OTP (06-23), then a confirm link (06-24) — replaced by the capped first-setup OTP. Earlier: `session.cookieCache` (2026-07) — reverted so revocation holds on every request.
- Rule: backup codes and email OTP grant recovery or setup only, never admin access.
- Rule: TOTP codes are single-use (Redis dedupe) with a per-user attempt throttle; verify via better-auth, never a home-grown TOTP check.
- Rule: Redis errors on privileged paths fail closed without destroying factors; failed auth results never create grants.
- Code: `apps/web/src/lib/server/step-up.ts`, `packages/application/src/api-token/security-settings.ts`, `packages/redis/src/keys.ts`

### SEC-05 Admin privilege starts only at explicit elevation; super admins have a stricter login

**Decided:** 2026-07 · **Source:** [2026-07-20-security-hardening](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-20-security-hardening.md), [2026-07-24-auth-rate-limit-admin-mode](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-24-auth-rate-limit-admin-mode.md), [2026-07-24-step-up-verification-modal](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-24-step-up-verification-modal.md), [2026-09-04-admin-mfa-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-09-04-admin-mfa-redesign.md), [2026-09-07-admin-signin-corrections](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-07-admin-signin-corrections.md)

Regular-admin sessions stay de-elevated until admin mode is granted with a fresh factor; `/api/admin-mode` answers 200 `{ active: false, verificationRequired: true }` (expected, not an error) and the shared step-up dialog reuses the existing verification action. Super admins sign in with password plus TOTP/passkey every session, get admin access directly, expire after 24h, and cannot use OAuth or passwordless passkey entry.

- Rejected: a second verification protocol for the modal; 403 for missing step-up.
- Rule: never activate admin mode without a valid fresh factor; callers navigate only when `active` is true.
- Rule: a super admin never loses their final factor, even under concurrent removal.
- Rule: pending sign-in recovers only from better-auth's signed cookie plus the live verification record; missing/expired/forged challenges fail closed. Fix sign-in flows without changing the role model.
- Code: `apps/web/src/routes/api/admin-mode/+server.ts`, `apps/web/src/routes/(auth)/admin-signin/+page.server.ts`

### SEC-06 Admin hierarchy is server-enforced, deliberate and audited

**Decided:** 2026-04 · **Source:** [2026-04-11-admin-users-ux-refinement-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-admin-users-ux-refinement-design.md), [2026-07-07-admin-account-ux-overhaul](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-admin-account-ux-overhaul.md)

The UI never shows "super admin"; only a super admin may disable, delete or change another admin. Role changes are explicit edit → pick → save, with `ConfirmDialog` for high-risk changes and disabling. Important actions are written to `AdminAuditLog`. A single mis-click once changed platform roles, and hiding a control is not enforcement.

- Rejected: auto-submitting role `<select>`; badge-as-button role editing.
- Rule: the server rejects self role change, self-disable and self-delete.
- Rule: power decisions use the effective `actor.platformRole`, never the stored session role.
- Code: `packages/application/src/user/mutations.ts`, `apps/web/src/routes/(app)/admin/users/+page.server.ts`, `packages/db/prisma/schema/ops.prisma`

### SEC-07 API tokens: hashed bearer secrets gated by whitelist, scope and owner role

**Decided:** 2026-06 · **Source:** [2026-06-09-api-token-auth](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-09-api-token-auth.md), [2026-06-24-passwordless-stepup-2fa](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-24-passwordless-stepup-2fa.md)

Tokens (`nojv_live_<prefix>.<secret>`) are stored as prefix plus `sha256` hash, shown once, and must expire (30/90/365 days). A request must pass the central method/path whitelist, then the token scope, then the owner's role; domain checks still enforce object access. Only whitelisted routes accept tokens and skip the CSRF header.

- Rejected: implicit token access for documented routes; never-expiring tokens. Earlier: HMAC with `API_TOKEN_PEPPER` — removed as redundant for 256-bit secrets (CodeQL `js/insufficient-password-hash` is a false positive).
- Rule: appearing in docs does not grant token access; internal APIs stay session-only unless whitelisted.
- Rule: no pepper for high-entropy secrets; low-entropy secrets need attempt caps and TTLs.
- Code: `packages/application/src/api-token/acl.ts`, `packages/application/src/api-token/lifecycle.ts`

### SEC-08 API token management requires fresh step-up on every action

**Decided:** 2026-06 · **Source:** [2026-06-23-api-token-step-up-2fa-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-23-api-token-step-up-2fa-design.md), [2026-06-23-api-token-step-up-2fa-implementation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-23-api-token-step-up-2fa-implementation.md)

Viewing or changing tokens needs a fresh step-up (SEC-04), checked on page load and on every create/update/rotate/revoke; users without a factor are sent to enroll. A stolen session must not mint long-lived bearer tokens, and load-only checks are bypassable by direct POST.

- Rejected: `trustDevice`; per-token step-up; step-up to use a token (bearer by design).
- Rule: the verify route itself never requires step-up (redirect loop).
- Rule: temporary exam-password sessions can never manage API tokens.
- Code: `apps/web/src/routes/(app)/account/api-tokens/+page.server.ts`, `apps/web/src/routes/api/api-token-access/+server.ts`

### SEC-09 Client IP comes only from the trusted edge

**Decided:** 2026-03 · **Source:** [2026-03-20-page-lock-ip-lock-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-03-20-page-lock-ip-lock-design.md)

One helper resolves the client IP for IP locks and rate limits. In production it trusts only `cf-connecting-ip` and returns 403 if missing or invalid; `x-dev-ip` works only outside production. IP locks are only as trustworthy as the IP they check.

- Rejected: Earlier: `x-forwarded-for` → `x-real-ip` → remote address (2026-03) — spoofable, replaced by the edge header.
- Rule: never read `x-forwarded-for` or `x-dev-ip` in production.
- Code: `apps/web/src/lib/server/shared/client-ip.ts`

### SEC-10 Markdown trust is nonce-based; body limits count streamed bytes

**Decided:** 2026-06 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

KaTeX output is wrapped with a per-render random nonce and DOMPurify keeps `style` only inside that subtree. JSON bodies are read through `readJsonBody`, which counts bytes while streaming and returns 413 regardless of `content-length`. Upload MIME is checked by magic bytes. A forgeable `katex` class allowed CSS injection, and chunked bodies bypassed header checks.

- Rejected: trusting author-controllable class names; header-only size checks.
- Rule: never use author-controllable markup as a trust signal.
- Code: `apps/web/src/lib/utils/markdown.ts`, `apps/web/src/lib/server/shared/api-handler.ts`

### SEC-11 Third-party Markdown images go through a same-origin SSRF-safe proxy

**Decided:** 2026-07 · **Source:** [2026-07-20-markdown-image-proxy](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-20-markdown-image-proxy.md)

The DOMPurify hook rewrites remote `img src`/`srcset` to `/api/images/proxy` at render time, which fetches over HTTPS:443 with pinned all-public DNS, bounded redirects/time/size, accepts only PNG/JPEG/GIF/WebP by magic bytes, and caches first-write-wins in S3. CSP `img-src` excludes arbitrary HTTPS so a missed rewrite fails closed. Readers' browsers never contact third-party hosts.

- Rejected: direct third-party loads (previous accepted privacy leak); redirecting to upstream on failure.
- Rule: never trust upstream Content-Type; read the cache before any fetch; rate-limit with the read limiter.
- Code: `apps/web/src/routes/api/images/proxy/+server.ts`, `packages/storage/src/images.ts`, `apps/web/svelte.config.js`

### SEC-12 Graded testcase data never reaches non-staff

**Decided:** 2026-05 · **Source:** [2026-05-12-submission-detail-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-12-submission-detail-redesign-design.md), [2026-05-27-submission-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-27-submission-unification-design.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

No view shows expected output or diffs. Students see per-case stdout/stderr only on sample runs (`sampleOnly`); graded cases show verdict, time and memory only. Every student-readable submission path runs `sanitizeStudentResult`, which drops `staffFeedback` from every case and `stdout`/`stderr` from non-sample `caseResults` and `subtaskResults`. An echo-stdin submission leaked hidden inputs through raw JSON even though the UI hid them.

- Rule: never render expected output; every new student-facing result endpoint goes through the sanitizer; the verdict sanitizer fails closed.
- Code: `packages/application/src/submission/scoring.ts`, `apps/web/src/lib/components/features/submission/CaseResultGrid.svelte`

### SEC-13 Rejudge control accepts only rejudge workflows owned by the caller or an admin

**Decided:** 2026-06 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

Cancel/progress accept only workflow IDs prefixed `rejudge-` that match a recorded rejudge dispatch whose `triggeredByUserId` is the caller, or an admin; unknown or non-rejudge IDs are 404 and other callers 403. Other workflow IDs are predictable, and students could cancel their own judge to dodge the daily attempt limit.

- Rejected: treating a workflow ID as a capability token (the earlier rejudge-ops design returned the ID to the starter as one).
- Rule: never pass a URL-supplied workflow ID to Temporal without prefix and ownership checks; the application layer reaches Temporal only through the orchestration adapter.
- Code: `packages/application/src/submission/rejudge-control.ts`

### SEC-14 Advanced-mode `/output` capture never dereferences student paths

**Decided:** 2026-06 · **Source:** [2026-06-14-advanced-judge-run-grade-split-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-14-advanced-judge-run-grade-split-design.md)

Run output is copied host-side by `safeCopyTree` (lstat first, drop symlinks and special files, cap ≤100k files and 1 GiB, overflow = SE); on Kubernetes a transfer sidecar applies the same gate into a per-submission PVC mounted read-only by the grade Job. A symlink like `output/x → /answers/secret` would leak answers into grading.

- Rejected: in-container `tar --dereference` (puts the security step in a TA image); pod-log/ConfigMap transfer (1 MB limit).
- Rule: Docker and Kubernetes gates stay behavior-identical (parity test); watchdogs count files as well as bytes.
- Code: `apps/worker/src/sandbox/docker/advanced-mode-executor.ts`, `apps/worker/src/sandbox/kubernetes/advanced-executor.ts`
