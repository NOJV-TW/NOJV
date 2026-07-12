# Security

Security requirements are first-class because this system handles authentication, student source code, hidden testcases, contest integrity, and grade-affecting assessment submissions.

## Sensitive Data

| Data                   | Storage                                                   | Protection                                                                        |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Passwords              | PostgreSQL `Account.password`                             | bcrypt hash                                                                       |
| OAuth tokens           | PostgreSQL `Account.accessToken`                          | Encrypted by better-auth                                                          |
| Session tokens         | PostgreSQL `Session.token`                                | httpOnly cookie                                                                   |
| Source code            | S3-compatible storage (`submissions/<id>/sources/<path>`) | Per-user access control; never served raw, only read by domain helpers + worker   |
| Graded testcases       | PostgreSQL `TestcaseSet` / `Testcase`                     | Never exposed to students; only `Problem.samples` is rendered on the problem page |
| Hidden workspace files | PostgreSQL `ProblemWorkspaceFile` (`visibility = hidden`) | Filtered out server-side before `ProblemDetail` leaves the domain layer           |
| Problem images         | S3-compatible storage                                     | Public read for problem paths                                                     |
| S3 credentials         | Environment variables                                     | .env untracked, Secret Manager in prod                                            |
| Database credentials   | Environment variables                                     | .env untracked, Secret Manager in prod                                            |

## Handling Rules

- Validate all user input with Zod schemas from `@nojv/core` before processing.
- Use `requireAuth(event)` for page routes and `requireApiAuth(event)` for API routes. Never skip authentication checks.
- Use `canEditProblem(platformRole)` for problem mutations. Use `isCourseStaff(role)` for course access.
- Effective course role = `max(platformRole, courseRole)` via `resolveEffectiveCourseRole()`. Admin overrides all.
- **Two-tier admin (sudo model).** An `admin` account browses as a normal user by default; admin power is granted only while it has toggled into "admin mode" for the session. `getActorContext` computes an **effective** `platformRole` (`resolveEffectivePlatformRole`) that downgrades a de-elevated admin to `student`, so every existing `platformRole === "admin"` check stays off until the toggle is on. The toggle is stored per-session in Redis (`keys.adminMode(sessionId)`) and flipped via `POST /api/admin-mode` (admin accounts only). Do NOT read `sessionUser.platformRole` for power decisions — use `actor.platformRole` (effective) so the toggle is honoured.
- **Super admin** = `isSuperAdmin && platformRole === "admin"`. Only super admins may grant/revoke the `admin` role (`updateUserRole` enforces it) or disable another super admin, and only super-admin logins are forced through the 2FA gate (`enforceAdminTwoFactor`, `hooks.server.ts`). Read `sessionUser.isSuperAdmin` (stored, toggle-independent) for these checks, never the effective role.
- Use Prisma parameterized queries for all database access. Never construct SQL strings.
- Use DOMPurify for all user-authored markdown rendering. The sanitizer is configured in `$lib/markdown.ts`.
- Keep `.env` untracked and treat `.env.example` as a shape-only template without real values.
- If any secret appears in a committed file, rotate it immediately.
- Session cookies are pinned by `apps/web/src/lib/auth.server.ts` `advanced.defaultCookieAttributes` to `{ httpOnly: true, secure: NODE_ENV === "production", sameSite: "lax" }`. This is explicit rather than relying on better-auth defaults so a future library upgrade can't silently relax the posture; `sameSite: lax` is required for the top-level OAuth callback nav.
- Rate-limit submission and plagiarism endpoints via Redis-backed `rate-limiter-flexible` (`RateLimiterRedis`). The limiter is keyed on `getClientIp(event)` so a single IP shares one counter across all SvelteKit replicas. If Redis is unreachable in production, the limiter falls back to a `failClosedLimiter` that rejects every request — never a per-instance in-memory counter (see `apps/web/src/lib/server/shared/rate-limiter.ts`).
- A dedicated `signInRateLimiter` (5 attempts / 15 min per IP) gates `POST /api/auth/sign-in/email` and `/api/auth/sign-in/username` in `hooks.server.ts`. OAuth flows do not hit this limiter — they're handled by the upstream provider's own anti-abuse.
- Account linking (`account.accountLinking`) sets `trustedProviders: ["github", "google"]` explicitly rather than relying on better-auth defaults: both providers return a verified primary email, so auto-linking a social login to an existing account by email is safe. Unlisted providers would require the existing account's email to already be verified before linking.
- **Signup-channel asymmetry (evaluated, accepted):** `emailAndPassword.disableSignUp: true` blocks self-service email/password registration, but social OAuth can still create a fresh account (better-auth's `disableSignUp` is email/password-scoped). This is acceptable because an account by itself grants no access to protected resources — course/contest/exam **enrollment** (teacher-driven, no self-join token) and resource ownership are the real authorization boundaries. A self-registered OAuth user with no enrollment sees only public surfaces. The `databaseHooks.user.create.after` placeholder merge (`mergePlaceholderIfAny`) lets a teacher pre-provision a roster by email that an OAuth login then claims.
- Image uploads must validate file type (png/jpeg/gif/webp), enforce 5MB size limit, require `canEditProblem` permission, AND run `detectImageMime(buffer)` magic-number validation server-side after the body is read — the client-reported `file.type` is never trusted alone (`apps/web/src/routes/api/problems/[id]/images/+server.ts`).
- **Request body size posture.** The global `BODY_SIZE_LIMIT` (64MB, adapter-node) exists for the legitimately-large upload routes (problem images, checker/interactor scripts, bundles) — each of which self-guards on `Content-Length` before reading and validates its payload. The one high-volume, student-facing JSON route, `POST /api/submissions`, pre-rejects bodies over `SUBMISSION_BODY_LIMIT` (2MB) on `Content-Length` (413) before parsing. The remaining JSON mutation routes call `assertJsonBodyWithinLimit(event)` (`$lib/server/shared/api-handler.ts`, default `JSON_BODY_LIMIT_BYTES` = 1MB) as their first statement, so a compromised staff token can't post a 64MB JSON bomb into them either. The upload routes (problem images, checker/interactor scripts, bundles) self-guard on their own larger `Content-Length` limits and are deliberately left off the 1MB helper. Do not lower the global cap without re-checking the largest legitimate upload (60MB bundle).
- Sandbox containers must run with `cap-drop ALL`, `no-new-privileges`, read-only rootfs, `--network none`, and resource limits. On Kubernetes the pod and container both set `runAsNonRoot: true` (`apps/worker/src/services/k8s-executor.ts`).
- Advanced Mode images run on K8s as Jobs with `cap-drop ALL`, `allowPrivilegeEscalation: false`, read-only rootfs, pod-level `seccompProfile: RuntimeDefault`, and `runAsNonRoot: true` (uid 10001) on **both** the run and grade pods; the Docker backend pins grade to the same uid. The answer-bearing grade container has **no network egress** on either backend (per-submission deny-all NetworkPolicy on K8s, `--network none` on Docker). Teacher image refs are digest-pinned and restricted to `ADVANCED_IMAGE_ALLOWED_REGISTRIES` at input, special_env authoring requires the per-user `canCreateAdvancedProblems` grant (admin-managed), and publishing requires an accepted test run with the exact configured images. See [THREAT_MODEL](THREAT_MODEL.md).
- Exam IP binding, page lock, and submit cooldown are server-side enforced (contests have no proctoring). Never trust client-side checks alone.
- Client IP in production is **only** sourced from the `CF-Connecting-IP` header. See [Client IP Trust Model](#client-ip-trust-model-cloudflare-only).

## Client IP Trust Model (Cloudflare-only)

Production trusts **Cloudflare as the sole ingress path**. The client IP used for all proctoring decisions (exam whitelist + binding, audit logs, session pinning) comes from the `CF-Connecting-IP` header, which the CF edge rewrites on every inbound request — any client-supplied value is discarded before the request leaves CF. Contests have no IP gating by product design.

Three layers protect this trust boundary; **all three are required**, and losing any one collapses it:

1. **Origin restricted to Cloudflare** — web runs in-cluster behind a GKE Ingress / load balancer, and the origin is configured to reject any request that did not arrive through Cloudflare, so direct-to-origin is impossible. Traffic must traverse the Cloudflare edge.
2. **Cloud Armor / edge allowlist** — the Ingress backend (GCLB) carries a source-IP allowlist restricted to the official Cloudflare CIDR ranges (<https://www.cloudflare.com/ips-v4> + <https://www.cloudflare.com/ips-v6>). Anything else returns 403 at the load balancer before reaching web.
3. **Application-level check** — `getClientIp(event)` in `apps/web/src/lib/server/shared/client-ip.ts` reads `CF-Connecting-IP`. If the header is missing in production, the request is rejected with 403. **No fallback** to `X-Forwarded-For` or the socket address — a weaker IP source is strictly worse than refusing.

If Cloudflare is ever replaced or removed, update the Cloud Armor allowlist and the header name in `client-ip.ts` **together** — a drift here silently breaks either availability or the spoofing defence.

Development mode (`NODE_ENV !== "production"`) uses the `x-dev-ip` header override for integration tests, falling back to `event.getClientAddress()` (socket address). This path is never taken in production.

Setup steps live in [DEPLOYMENT.md — Cloudflare + Cloud Armor](DEPLOYMENT.md#cloudflare--cloud-armor-setup).

## Sandbox Hardening (seccomp posture)

Sandbox containers rely on **Docker's default seccomp profile**, which already blocks roughly 44 high-risk syscalls (`kexec_load`, `bpf`, `userfaultfd`, `add_key`, etc.). We deliberately **do not ship a custom seccomp profile** — language runtimes (Python, Node, JVM, Go, Rust) touch a very wide and version-dependent syscall surface, so a tight custom allowlist has high false-negative cost (legitimate programs crash on the next compiler release) for marginal incremental protection.

Defence-in-depth is therefore layered on the cheap-but-strong primitives instead:

- `--cap-drop ALL` — removes every Linux capability, including `CAP_SYS_ADMIN` and `CAP_NET_RAW`.
- `--security-opt no-new-privileges` — prevents setuid/setgid binaries from regaining capabilities.
- read-only rootfs + bounded `tmpfs` on `/tmp` (64m) and `/workspace` (128m) — no host-writable persistence path.
- non-root UID inside the container; on Kubernetes both pod and container set `runAsNonRoot: true`.
- `--network none` (default) — kernel-level network namespace isolation.
- Strict CPU / memory / PID limits.

If a future audit identifies a specific syscall that materially expands the attack surface, the right move is to extend the Docker default profile incrementally — not to invent a from-scratch allowlist.

## Problem Post Visibility Gate

Problem posts (editorials and discussions) must not be readable or
writable inside an event that re-uses the problem, even when the
viewer earned AC in past practice. The gate is enforced by
`canViewPosts(userId, problemId, type, context)` in
`packages/application/src/post/queries.ts`:

- `PostViewContext` is one of `{ kind: "practice" }`,
  `{ kind: "contest", contestId, now }`,
  `{ kind: "assignment", assignmentId, now }`, or
  `{ kind: "exam", examId, now }`.
- For non-practice contexts the gate only opens once the event has
  passed its deadline (`contest.endsAt`, `assessment.closesAt`,
  `exam.endsAt`). The context gate applies to **both** post types and
  is checked before any exception — discussions can leak answers just
  as easily as editorials, and authorship does not open a live event.
- With the context gate open, `discussion` requires only a signed-in
  user; `editorial` additionally requires an accepted submission OR an
  authored editorial on the problem (the "rejudge grandfather" rule —
  see the posts spec). Admins bypass the view gate for moderation
  (`requireProblemPostAccess` in
  `apps/web/src/lib/server/post-access.ts`).

**The client cannot supply or override the context.** Every post /
comment / vote / report endpoint resolves it server-side via
`resolveActiveContextForUser(userId, problemId, now)`, which scans
every currently-running contest / assignment / exam that contains the
problem and that the user is enrolled in, then picks the latest-ending
one (the strictest gate). Only falls back to `practice` when no live
event matches. This closes the bypass where a student who AC'd a
problem in past practice could read posts via
`GET /api/problems/<id>/posts` while a live contest re-using the
same problem was still running. As defense in depth, the exam
confinement hook (`apps/web/src/lib/server/exam-lock.ts`) rejects
`/api/posts/*`, `/api/comments/*`, and `/api/problems/[id]/posts`
outright while the actor holds an active exam session.

## Plagiarism Tokenization (Multi-file)

The plagiarism check feeds source code into Dolos. Multi-file
submissions are loaded via
`submissionDomain.getSubmissionSources(id)` (S3-backed) and
concatenated in **sorted path order** with `// === <path> ===\n`
boundary markers before tokenization
(`packages/application/src/plagiarism/queries.ts`). The earlier path that
JSON-stringified the whole file map masked semantic similarity behind
JSON syntax tokens; the comment-marker concatenation restores
tokenization fidelity because every Dolos-supported language treats
`//` as a line comment and the markers are dropped by the tokenizer.

## Input Validation

| Input             | Schema                    | Limits                                            |
| ----------------- | ------------------------- | ------------------------------------------------- |
| Source code       | `sourceCodeSchema`        | 1–50,000 chars, trimmed                           |
| Slug              | `slugSchema`              | 3+ chars, `[a-z0-9-]+`                            |
| Problem statement | Markdown text             | Per-field limits (statement 12k, input/output 4k) |
| Problem images    | File upload               | png/jpeg/gif/webp, 5MB max                        |
| Testcase input    | Text                      | Stored as `@db.Text`                              |
| Problem post      | `postSubmitSchema`        | title 1–200 chars, content 10–50,000 chars        |
| Post comment      | `postCommentSubmitSchema` | 1–5,000 chars, trimmed                            |
| Content report    | `contentReportSchema`     | reason 1–1,000 chars                              |

## Dependency Advisory Posture

CI runs `pnpm audit --audit-level high` as a **blocking gate** — any
high/critical advisory fails the build (currently 0).

The previously-tracked moderate/low transitive advisories are now pinned to
patched versions through `pnpm.overrides` in the root `package.json`
(`monaco-editor > dompurify`, `@prisma/dev > @hono/node-server`,
`@sveltejs/kit > cookie`, `sveltekit-superforms > joi`); `pnpm audit` reports
**zero** known vulnerabilities (prod + dev).

**Gate decision:** keep the threshold at `high`.

**Cadence:** review `pnpm audit` monthly and prune the override list as the
upstreams (`monaco-editor`, `@sveltejs/kit`, `prisma`, `sveltekit-superforms`)
ship the patched dependency natively.

## Review Expectations

Flag for security review when:

- Adding or modifying authentication or authorization logic
- Changing sandbox isolation configuration
- Adding new API routes that handle user input
- Modifying contest integrity features (IP binding, cooldown, page lock)
- Changing file upload or storage logic
- Adding new environment variables that contain secrets

## Related Docs

- [Threat Model](./THREAT_MODEL.md)
- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Frontend Surface](../architecture/FRONTEND.md)
- [Reliability Invariants](./RELIABILITY.md)
