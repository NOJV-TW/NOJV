# Security

Security controls as implemented: what must hold and where it is enforced. Attackers, scenarios and residual risk live in the [Threat Model](THREAT_MODEL.md); why-decisions live in [security decisions](../decisions/security.md) (`SEC-*`) and the sandbox entries of [judge decisions](../decisions/judge.md) (`JDG-*`).

## Key code

- `apps/web/src/hooks.server.ts` — per-request pipeline: client IP, CSRF, auth rate limits, session load, exam gates, security headers
- `apps/web/src/lib/server/hooks/request-security.ts` — `enforceCsrf`, `setSecurityHeaders`
- `apps/web/src/lib/server/shared/client-ip.ts` — `getClientIp`
- `apps/web/src/lib/server/shared/rate-limiter.ts`, `api-handler.ts` — limiters, `apiHandler`/`writeApiHandler`, `readJsonBody`
- `apps/web/src/lib/auth.server.ts` — better-auth config and `hooks.before` gates
- `apps/web/src/lib/server/auth.ts` — `requireAuth`, `requireApiAuth`, `requirePlatformRole`, `resolveCoursePermission`
- `apps/web/src/lib/server/step-up.ts` — admin access, super-admin session proof, step-up unlocks
- `packages/application/src/shared/permissions.ts`, `packages/application/src/problem/permissions.ts` — course and problem authorization
- `packages/application/src/api-token/acl.ts` — API token route whitelist
- `apps/web/src/lib/utils/markdown.ts` — DOMPurify sanitizer and remote-image rewrite
- `apps/web/svelte.config.js` — CSP
- `apps/worker/src/sandbox/docker/args.ts`, `apps/worker/src/sandbox/kubernetes/pod-spec.ts` — sandbox hardening
- `infra/charts/nojv/templates/{namespaces,sandbox-policy,worker-rbac,web.ingress,cloudflared.deployment}.yaml` — cluster-level controls

## Sensitive Data

| Data                     | Storage                                                 | Protection                                                                             |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Credential passwords     | `Account.password`                                      | bcrypt (cost 10) via `emailAndPassword.password.hash`                                  |
| Temporary exam passwords | `ExamCredential.passwordHash` / `passwordCiphertext`    | scrypt hash + ciphertext keyed by `BETTER_AUTH_SECRET`; staff reveal; hard expiry      |
| OAuth provider tokens    | `Account.accessToken` / `refreshToken`                  | Encrypted with `BETTER_AUTH_SECRET` (`account.encryptOAuthTokens`); never read by NOJV |
| Session tokens           | `Session.token`                                         | httpOnly cookie; checked every request (no cookie cache)                               |
| API tokens               | `ApiToken` prefix + sha256 hash                         | Shown once, mandatory expiry (SEC-07)                                                  |
| TOTP enrollment material | Redis, pending until confirmed                          | Encrypted; committed atomically with backup codes on confirmation                      |
| Submission source        | Object storage `submissions/<id>/sources/<path>`        | Read only via domain helpers and the worker                                            |
| Graded testcases         | `TestcaseSet` / `Testcase` + object storage             | Never reach non-staff (SEC-12); only `Problem.samples` is rendered                     |
| Hidden workspace files   | `ProblemWorkspaceFile` (`visibility = hidden`)          | Filtered in the application layer; merged only by the worker                           |
| Advanced grade images    | Registry `t/<username>/…`                               | Hold answers; namespace-scoped registry tokens ([Sandbox](#sandbox-isolation))         |
| Code drafts              | `CodeDraft` rows; unsynced edits in `localStorage`      | Owner-only; local edits sealed ([Integrity](#exam-and-contest-integrity))              |
| Problem / user images    | Object storage, served same-origin via `/api/storage/*` | Public read; never store secret material there (PRB-05)                                |
| Runtime secrets          | `.env` locally; chart Secret `nojv-runtime-secrets`     | `.env` untracked; `.env.example` shape-only                                            |

## Request Boundary

### Client IP Trust Model (Cloudflare-only)

`getClientIp(event)` is the single client-IP source for exam IP rules, rate-limit keys and audit logs (SEC-09, OPS-08).

- Production reads only `CF-Connecting-IP`; a missing or non-IP value returns 403. No fallback to `X-Forwarded-For`, `X-Real-IP` or the socket address.
- Development (`NODE_ENV !== "production"`) accepts a valid `x-dev-ip` header, else `event.getClientAddress()`.
- The header is trustworthy only while Cloudflare is the sole path to the origin. Both chart edge modes enforce that:

| Mode                 | Origin exposure                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-machine (k3s) | In-cluster `cloudflared` tunnel (`edge.cloudflared.enabled`) to a ClusterIP web Service; no NodePort or ingress                                                      |
| GKE                  | `gce` Ingress whose BackendConfig attaches a Cloud Armor policy allowing only Cloudflare CIDRs; production preflight refuses a missing policy, TLS or HTTPS redirect |

Rules: no non-Cloudflare path to the web origin may exist while the header is trusted. When changing edge trust, lock the origin first and remove the old mechanism in a later deploy; change `client-ip.ts` and the edge allowlist together. Setup: [Deployment — Cloudflare + Cloud Armor](DEPLOYMENT.md#cloudflare--cloud-armor-setup).

### CSRF and headers

SvelteKit `csrf.checkOrigin` is disabled so `/api/registry/token` can accept the Docker client's cross-origin form POST; `enforceCsrf` replaces it for every non-GET/HEAD/OPTIONS request:

- Form content types (`x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, `x-sveltekit-formdata`) require `Origin` equal to the site origin (missing `Origin` fails).
- `/api/*` rejects a foreign `Origin`, and outside `/api/auth` requires `X-Requested-With: fetch`.
- Exempt: `/api/registry/token` (Basic/body credentials, no cookies) and API-token requests on whitelisted routes.

`setSecurityHeaders` sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, COOP/COEP/CORP same-origin/`require-corp`/same-origin, a restrictive `Permissions-Policy`, and HSTS in production. CSP (`svelte.config.js`, nonce mode `auto`): `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`; `img-src` allows only `self`, `data:`, `blob:`, GitHub/Google avatar hosts and Google Analytics.

### Body size

- Global adapter-node `BODY_SIZE_LIMIT` is 64 MiB (`infra/docker/web.Dockerfile`), sized for the largest upload (60 MB bundle). Do not lower it without re-checking that.
- `POST /api/submissions`: 2 MiB (`MAX_SUBMISSION_BODY_BYTES`), `Content-Length` pre-check then streamed count.
- Other JSON mutation routes: 1 MiB via `assertJsonBodyWithinLimit` + `readJsonBody` (`JSON_BODY_LIMIT_BYTES`); `readJsonBody` counts streamed bytes and returns 413 regardless of `Content-Length` (SEC-10).
- Upload routes (images, checker/interactor, bundle, workspace files) enforce their own size limits.

### Rate limits

`rate-limiter-flexible` on Redis (`RateLimiterRedis`), shared across web replicas. `apiHandler`-family wrappers key on `u:<userId>` when signed in (session or API token), else client IP; all other limiters key on client IP.

| Limiter                       | Quota      | Applies to                                                                  |
| ----------------------------- | ---------- | --------------------------------------------------------------------------- |
| `apiRateLimiter`              | 300 / min  | `apiHandler` routes; per-replica memory fallback when Redis is down         |
| `writeApiRateLimiter`         | 10 / min   | `writeApiHandler` routes (submissions, uploads, plagiarism runs, …)         |
| `draftApiRateLimiter`         | 60 / min   | `/api/drafts`                                                               |
| form actions                  | 20 / min   | `withRateLimit` form actions                                                |
| `authRateLimiter`             | 60 / min   | Every `/api/auth/*` request, including OAuth and exam sign-in               |
| `signInRateLimiter`           | 5 / 15 min | `POST /api/auth/sign-in/email`, `/sign-in/username`                         |
| `examSignInRateLimiter`       | 5 / 15 min | `POST /api/auth/sign-in/exam-password`, keyed by IP + normalized username ¹ |
| `otpSendRateLimiter`          | 3 / 10 min | Email OTP sends                                                             |
| `stepUpAttemptRateLimiter`    | 5 / 10 min | Step-up verification attempts                                               |
| `registryTokenRateLimiter`    | 60 / min   | `/api/registry/token`                                                       |
| `remoteAssetFetchRateLimiter` | 10 / min   | Image-proxy cache misses                                                    |

¹ Students sharing a classroom IP do not consume each other's quota; invalid usernames share one bucket per IP.

- Quotas count every attempt, including successful sign-ins.
- In production, every limiter except `apiRateLimiter` fails closed (429 limited, 503 unavailable) on operational Redis errors; programming errors propagate (DAT-12).
- Development uses in-memory limiters with a ×1000 multiplier.

## Authentication and Sessions

Behavior specs: [Login and security verification](../features/login-security.md). Decisions: SEC-01 to SEC-08.

- Cookies are pinned in `advanced.defaultCookieAttributes` to `{ httpOnly: true, secure: NODE_ENV === "production", sameSite: "lax" }` so a library upgrade cannot relax them; `lax` is required for the top-level OAuth callback.
- `emailAndPassword.disableSignUp: true`; credential accounts are admins created by `db:bootstrap-admin`. OAuth (GitHub, Google) can create a fresh account, which grants nothing beyond public surfaces: enrollment is teacher-driven and ownership is the authorization boundary.
- `account.accountLinking.disableImplicitLinking: true`: an unseen provider identity is never attached by matching email. Providers are linked only from settings by a signed-in session (`trustedProviders: ["github", "google"]`, `allowDifferentEmails: true`). `onAPIError.errorURL` is `/signin`; the settings link uses `errorCallbackURL: "/settings"`, and both pages name `account_not_linked` and `account_already_linked_to_different_user` explicitly.
- `User.email` is the security mailbox (security OTP, recovery mail, email verification), never a login key. It changes only through the settings `changeSecurityEmail` action → better-auth `changeEmail`, gated in `hooks.before` on `/change-email`: new address unused by another account, confirmation from the current mailbox before the new one is verified, and a security-settings unlock when the account has TOTP or a passkey. Super admins cannot change it. `NotificationPreference.email` never receives security mail.
- Sessions are resolved on every request with `auth.api.getSession()`; `requireAuth` (pages) / `requireApiAuth` (API) also require a completed profile (`hasActorUsername`).
- Effective role: `getActorContext` computes `actor.platformRole`. Power decisions use it, never `sessionUser.platformRole` (SEC-06).
  - Regular `admin`: effective `student` until `POST /api/admin-mode` finds a generation-bound TOTP/passkey proof; it then grants seven-day admin access for that session. The proof stays reusable for ten minutes after leaving admin mode.
  - Super admin: credential password then TOTP/passkey on every new session; admin access is granted directly and never via `/api/admin-mode`. OAuth sign-in/linking and passwordless passkey sign-in are rejected (`hooks.before` and the `account.create` database hook). Session and MFA proof expire 24 hours after the original password authentication, including across passkey session rotation.
  - Only a super admin may change, disable or delete another admin; self role change, self-disable and self-delete are rejected; actions go to `AdminAuditLog`.
- Step-up and factors (SEC-04): verified TOTP/passkey rows are the only configured-state source. Email OTP unlocks only the first setup when no factor exists. Unlocks last ten minutes and bind to session and `securityGeneration`. TOTP codes are single-use with a per-user attempt throttle. Failed better-auth results never create grants. Redis failure on privileged paths fails closed without destroying factors. A super admin's final factor cannot be removed.
- Recovery (super admin): password first, then a backup code or email OTP; revokes other sessions, deletes old factors, grants setup-only access. Backup codes and recovery OTP never grant admin access.
- Temporary exam sign-in: sessions carry an immutable `Session.examPassword` marker plus an `ExamCredentialSession` revision association checked on every request and direct Auth API call; missing provenance fails closed. Such sessions cannot change account security, link providers, manage API tokens or obtain registry credentials; accounts with any staff role are ineligible. Mail goes only to verified `User.email`; durable jobs carry IDs, never passwords. Lifecycle: [Exams — Temporary exam sign-in](../features/exams.md#temporary-exam-sign-in).
- API tokens (SEC-07, SEC-08): a bearer token must pass the method/path whitelist in `acl.ts`, then the token scope, then the owner's role; domain checks still apply. Token management requires fresh step-up on page load and on every mutation.

## Authorization

- Validate every input with Zod schemas from `@nojv/core`; use Prisma parameterized queries only.
- Course: `resolveCourseRole(platformRole, membership)` counts only an active membership (effective admin overrides); `canManageCourse` = admin/teacher/TA; `canManageMembers` = admin/teacher. Every course-manager check goes through `isCourseManager`, `getCourseRole` or `assertCourseManager` in `@nojv/application` (ASM-25). Grants come from a bound active membership or effective admin; `Course.ownerId`, creator fields and pending usernames are not grants. Creating or copying a course requires `canCreateCourse` (platform teacher/admin), enforced inside `createCourseRecord` and `copyCourse`. TAs may enroll and remove students (including pending roster identities) but cannot remove teachers/TAs, assign TA roles, change roles or correct pending usernames (ASM-05); owner and teacher protections are enforced inside the roster transaction.
- Roster rows (`CourseMembership` with `pendingUsername`) bind to a User only by a username that User already owns, under roster identity locks (ASM-04, SEC-03). Unbound rows grant no account access.
- Problems: authorize against the actor and the problem resource, not platform role alone.
  - Create (`canAuthorProblems`): admin, teacher, email-verified user, or active course staff. `special_env` additionally needs the admin-managed `canCreateAdvancedProblems` grant.
  - Read/edit content (`canProblemContentRead` / `canProblemContentEdit`): effective admin or owner; active teacher/TA of a course bound via `CourseProblem` for private problems only. Public originals grant no course co-edit; course archive removes edit but keeps read.
  - Writes recheck in-transaction with `lockProblemForEdit`: Course rows in stable order, then the actor's memberships, `CourseProblem` rows, then Problem. Early upload checks do not replace this; a revoked upload must not commit.
  - Co-editing grants no ownership operations, public-publication consent, bundle export, cross-course sharing or access to unrelated submissions. Private reference solutions have their own read gate. See [Database — Problem Ownership](../architecture/DATABASE.md#problems).
- Submissions: `getSubmissionForActor` returns the actor's own submission (admins included for recovery) or a reference solution the actor may read; anything else is 404. Every student-readable result path goes through `sanitizeStudentResult` (SEC-12).
- Rejudge control accepts only `rejudge-` workflow IDs recorded with the caller as `triggeredByUserId`, or an admin (SEC-13).
- Plagiarism reports and sources: course staff for the target (`assertCanManagePlagiarism`).
- Problem posts (UI-05; spec: [Posts](../features/posts.md)): every post/comment/vote/report path resolves the context server-side with `resolveActiveContextForUser` and checks `canViewPosts`. While a contest, assignment or exam containing the problem is running for the user, both post types are closed, before any author exception. Otherwise discussions need sign-in; editorials need AC or an authored post on the problem. Admins bypass for moderation (`requireProblemPostAccess`).

## Content and Uploads

- User Markdown is sanitized with DOMPurify in `$lib/utils/markdown.ts`. KaTeX output is trusted only inside a per-render random nonce wrapper; never use author-controllable markup as a trust signal (SEC-10).
- Image uploads (`/api/problems/[id]/images` with problem-edit access and in-transaction recheck; `/api/uploads/image` for any signed-in user): png/jpeg/gif/webp, ≤ 5 MB, `detectImageMime(buffer)` magic bytes must match; the client `file.type` is never trusted alone. Keys are server-built (`problems/<problemId>/images/<uuid>.<ext>`). Avatars: webp only, ≤ 1 MB, magic-byte checked.
- Testcase, checker, interactor and workspace-file uploads count against a 50 MB per-problem budget (`assertProblemStorageBudget`); bundles are ≤ 60 MB uploaded, ≤ 50 MB inflated, ≤ 200 entries and reject `..` and absolute paths (PRB-06). Images are not budgeted.
- Remote Markdown images (SEC-11): the sanitizer rewrites remote `src`/`srcset` to `/api/images/proxy`; CSP blocks any missed rewrite. The proxy accepts canonical HTTPS on 443 only (URL ≤ 2048 chars, no credentials), requires every DNS answer to be public (mixed answers fail), pins the validated address into the TLS request, revalidates each redirect (max 3), times out at 5 s, stops at 5 MB, and accepts only magic-byte-verified png/jpeg/gif/webp (upstream MIME ignored). The first success is cached under `remote-images/<sha256(url)>`; hits never contact the remote host. Errors never redirect the viewer upstream.
- `/docs?api=full` and `/api/openapi.internal.json` are public by design; they hold no credentials and grant nothing.

## Exam and Contest Integrity

Behavior specs: [Exams](../features/exams.md), [Proctoring](../features/proctoring.md), [Contests](../features/contests.md).

- Exam IP whitelist, IP binding and page lock are server-side (ASM-19, ASM-20). During an active exam session `hooks.server.ts` runs the proctoring gate on every page and `/api` request, and submission rechecks it; a failed active-exam lookup fails closed with 503. Exam entry runs the gate before creating a session, the first IP pin is a conditional write so concurrent first requests cannot both bind, violations recorded by a denied entry or submission are committed before the denial, and every binding reset writes an `ip_reset` session event. Page lock also denies `/api/contests/*`, `/api/posts/*`, `/api/comments/*` and `/api/problems/[id]/posts`. Contests have no IP or page gating.
- Context-bound submissions and drafts must target a problem in that context (ASM-21).
- Exam and contest `submitCooldownSec` is checked in PostgreSQL under a `pg_advisory_xact_lock` keyed by context, user and problem (`packages/application/src/shared/submit-cooldown.ts`); sample runs are exempt.
- Code drafts: `CodeDraft` rows are owner-only via `/api/drafts`. Exam drafts can be written only during an active session on a running exam for a problem in it; during a session only that exam's drafts are reachable. Unacknowledged local edits are stored under `nojv:draft:v2:<userId>:…`, AES-GCM sealed with `HMAC-SHA256(BETTER_AUTH_SECRET, "code-draft:<userId>")` delivered only to that user's `(app)` layout, with the storage key as additional authenticated data. Legacy plaintext `nojv:draft:v1:` drafts are re-sealed for the first opener, except exam drafts, which are never adopted.

## Sandbox Isolation

Pipeline and Advanced Mode mechanics: [Judge Pipeline](../architecture/JUDGE_PIPELINE.md). Decisions: JDG-05, JDG-06, JDG-17 to JDG-22.

Baseline for every sandbox container (Docker args from the single builder in `args.ts`, golden-tested; K8s `securityContext` from `pod-spec.ts`):

| Control         | Docker                                                                                               | Kubernetes                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Capabilities    | `--cap-drop ALL`                                                                                     | `capabilities.drop: [ALL]`                                                               |
| Privilege       | `--security-opt no-new-privileges`                                                                   | `allowPrivilegeEscalation: false`                                                        |
| User            | `--user 10001:10001`                                                                                 | `runAsNonRoot: true`, uid/gid 10001                                                      |
| Root filesystem | `--read-only`; tmpfs `/tmp` 64m (compiler scratch when compiling), `/workspace` 128m, `nosuid,nodev` | `readOnlyRootFilesystem: true`                                                           |
| Host mounts     | `/submission` read-only; `/artifact`, `/outputs` only where the stage needs them                     | Payload via hash-verified ConfigMap shards into emptyDir (JDG-21)                        |
| Network         | `--network none` (Advanced `service` mode: per-submission `--internal` network)                      | Namespace deny-all NetworkPolicy; Advanced per-submission policies                       |
| Resources       | `--cpus`, `--memory` = `--memory-swap`, `--pids-limit` (`SANDBOX_*` env)                             | Requests/limits, namespace ResourceQuota and LimitRange                                  |
| seccomp         | Docker default profile                                                                               | `seccompProfile: RuntimeDefault` + `gvisor` RuntimeClass (required by worker env schema) |
| Output capture  | 16 MB per stream (`createBoundedStringBuffer`)                                                       | same                                                                                     |

Seccomp posture: no custom profile. The runtime default already blocks high-risk syscalls (`kexec_load`, `bpf`, `userfaultfd`, `add_key`, …), and a custom allowlist would break language runtimes across toolchain upgrades. If a specific syscall must be blocked, extend the default profile incrementally.

Kubernetes requirements (JDG-20):

- The sandbox namespace enforces Pod Security `restricted` (enforce/audit/warn). Pods mount no service-account token.
- The worker refuses to start unless the `gvisor` RuntimeClass, a hardened smoke Pod and a NetworkPolicy enforcement probe succeed. A CNI that enforces NetworkPolicy is a hard dependency.
- Split identities: the judge worker's `sandbox-job-manager` role has only create/get/list/watch/delete on sandbox resources; the platform worker has only the registry-GC role (token unmounted when the registry is disabled). Never add update, patch, Secret or cross-namespace access.

Advanced Mode (JDG-16, JDG-17, SEC-14, PRB-12):

- Answers live only in the grade container, which has no egress on either backend and runs as uid 10001. The run container reaches at most one service sidecar; the service has no egress.
- `/output` crosses to grade only through `safeCopyTree` (symlinks and special files dropped, ≤ 100k files, ≤ 1 GiB).
- Image refs must be digest-pinned and from `ADVANCED_IMAGE_ALLOWED_REGISTRIES`; authoring needs `canCreateAdvancedProblems`; publishing needs an accepted test run with the exact configured images.
- Registry (OPS-10): Docker token auth via `/api/registry/token` against hashed `RegistryCredential`s. Every human credential, admins included, can push/pull only `t/<username>/…`; judge pods use a pull-only account; `demo/…` is anonymous-pull; catalog and deletion use server-internal short-lived tokens.

## Infrastructure

- `docker-compose.yml` runs only local backing services, each published on `127.0.0.1`; no app services (OPS-01).
- GKE production preflight requires external Redis and object storage, Cloud SQL proxy, `networkPolicy.enabled` with private egress CIDRs, and the Cloud Armor ingress settings above.
- Public exact-path endpoints: `/api/livez` (`{ alive }`), `/api/readyz` (`{ ready }`), `/api/release` (tag and source SHA). They skip token auth, session loading, CSRF and rate limiting; request IDs and security headers still apply. Subsystem status is admin-only at `/api/admin/healthz`. Worker `/healthz` is cluster-internal.
- `apiHandler` returns only classified messages (Zod errors include issue paths); stack traces and internals are logged server-side only.
- If any secret appears in a committed file, rotate it immediately.

## Input Validation

| Input                  | Schema                                                  | Limits                                                               |
| ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| Single-file submission | `submissionDraftSchema.sourceCode` (`sourceCodeSchema`) | 1–50,000 chars, not blank                                            |
| Multi-file submission  | `submissionDraftSchema.sourceFiles`                     | ≤ 200 files, ≤ 500,000 chars each, safe relative paths; body ≤ 2 MiB |
| Custom run cases       | `runCaseSchema`                                         | ≤ 10 cases, ≤ 200,000 chars per field, sample-only runs              |
| Code draft             | `codeDraftSaveSchema`                                   | Same file limits as multi-file submission                            |
| Contest id             | `slugSchema`                                            | ≥ 3 chars, `[a-z0-9]+(-[a-z0-9]+)*`                                  |
| Problem statement      | problem schemas                                         | statement ≤ 12,000; input/output format ≤ 4,000                      |
| Testcase file          | `MAX_TESTCASE_FILE_BYTES`                               | ≤ 10 MiB UTF-8                                                       |
| Image upload           | multipart                                               | png/jpeg/gif/webp, ≤ 5 MB, magic bytes                               |
| Problem post           | `postSubmitSchema`                                      | title 1–200 (trimmed), content 10–50,000                             |
| Post comment           | `postCommentSubmitSchema`                               | 1–5,000, trimmed                                                     |
| Content report         | `contentReportSchema`                                   | reason 1–1,000                                                       |

## Dependency Advisories

CI runs `pnpm audit --audit-level high` as a blocking gate alongside CodeQL (OPS-13). There is no suppression list; lagging upstream ranges are pinned to patched versions through `overrides` in `pnpm-workspace.yaml`. Review monthly and drop overrides once upstreams ship the fix.

## Review Expectations

Flag for security review when a change:

- Adds or modifies authentication, sessions, step-up or authorization logic
- Changes sandbox isolation, sandbox RBAC, NetworkPolicy or the registry
- Adds an API route that handles user input, or adds a route to the API token whitelist
- Touches exam or contest integrity (IP rules, page lock, cooldown, drafts)
- Changes upload, storage, Markdown sanitizing or the image proxy
- Changes edge trust (Cloudflare, Cloud Armor, tunnel, ingress, service type)
- Adds an environment variable that carries a secret

## Related Docs

- [Threat Model](THREAT_MODEL.md)
- [Judge Pipeline](../architecture/JUDGE_PIPELINE.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Reliability Invariants](RELIABILITY.md)
- [Security decisions](../decisions/security.md)
