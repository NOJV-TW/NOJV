# Security

Security requirements are first-class because this system handles authentication, student source code, hidden testcases, contest integrity, and grade-affecting assessment submissions.

## Sensitive Data

| Data                    | Storage                                                    | Protection                                                                        |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Passwords               | PostgreSQL `Account.password`                              | bcrypt hash                                                                       |
| OAuth tokens            | PostgreSQL `Account.accessToken`                           | Encrypted by better-auth                                                          |
| Session tokens          | PostgreSQL `Session.token`                                 | httpOnly cookie                                                                   |
| Source code             | PostgreSQL `Submission.sourceCode`                         | Per-user access control                                                           |
| Graded testcases        | PostgreSQL `TestcaseSet` / `Testcase`                      | Never exposed to students; only `Problem.samples` is rendered on the problem page |
| Hidden workspace files  | PostgreSQL `ProblemWorkspaceFile` (`visibility = hidden`)  | Filtered out server-side before `ProblemDetail` leaves the domain layer           |
| Problem images          | S3-compatible storage                                      | Public read for problem paths                                                     |
| Advanced judge tarballs | S3-compatible storage (`problems/*/advanced-images/*.tar`) | Private, streamed to worker via signed URL at judge time                          |
| S3 credentials          | Environment variables                                      | .env untracked, Secret Manager in prod                                            |
| Database credentials    | Environment variables                                      | .env untracked, Secret Manager in prod                                            |

## Handling Rules

- Validate all user input with Zod schemas from `@nojv/core` before processing.
- Use `requireAuth(event)` for page routes and `requireApiAuth(event)` for API routes. Never skip authentication checks.
- Use `canEditProblem(platformRole)` for problem mutations. Use `isCourseStaff(role)` for course access.
- Effective course role = `max(platformRole, courseRole)` via `resolveEffectiveCourseRole()`. Admin overrides all.
- Use Prisma parameterized queries for all database access. Never construct SQL strings.
- Use DOMPurify for all user-authored markdown rendering. The sanitizer is configured in `$lib/markdown.ts`.
- Keep `.env` untracked and treat `.env.example` as a shape-only template without real values.
- If any secret appears in a committed file, rotate it immediately.
- Session cookies are pinned by `apps/web/src/lib/auth.server.ts` `advanced.defaultCookieAttributes` to `{ httpOnly: true, secure: NODE_ENV === "production", sameSite: "lax" }`. This is explicit rather than relying on better-auth defaults so a future library upgrade can't silently relax the posture; `sameSite: lax` is required for the top-level OAuth callback nav.
- Rate-limit submission and plagiarism endpoints via Redis-backed `rate-limiter-flexible` (`RateLimiterRedis`). The limiter is keyed on `getClientIp(event)` so a single IP shares one counter across all SvelteKit replicas. If Redis is unreachable in production, the limiter falls back to a `failClosedLimiter` that rejects every request — never a per-instance in-memory counter (see `apps/web/src/lib/server/shared/rate-limiter.ts`).
- A dedicated `signInRateLimiter` (5 attempts / 15 min per IP) gates `POST /api/auth/sign-in/email` and `/api/auth/sign-in/username` in `hooks.server.ts`. OAuth flows do not hit this limiter — they're handled by the upstream provider's own anti-abuse.
- Image uploads must validate file type (png/jpeg/gif/webp), enforce 5MB size limit, require `canEditProblem` permission, AND run `detectImageMime(buffer)` magic-number validation server-side after the body is read — the client-reported `file.type` is never trusted alone (`apps/web/src/routes/api/problems/[id]/images/+server.ts`).
- Sandbox containers must run with `cap-drop ALL`, `no-new-privileges`, read-only rootfs, `--network none`, and resource limits. On Kubernetes the pod and container both set `runAsNonRoot: true` (`apps/worker/src/services/k8s-executor.ts`).
- The Kubernetes executor refuses Advanced Mode requests (`request.advanced === true`) with a System Error verdict — the K8s path cannot `docker load` a TA-supplied tarball, so operators running advanced-mode problems must deploy the Docker backend.
- Exam IP binding, page lock, and submit cooldown are server-side enforced (contests have no proctoring). Never trust client-side checks alone.
- Client IP in production is **only** sourced from the `CF-Connecting-IP` header. See [Client IP Trust Model](#client-ip-trust-model-cloudflare-only).

## Client IP Trust Model (Cloudflare-only)

Production trusts **Cloudflare as the sole ingress path**. The client IP used for all proctoring decisions (exam whitelist + binding, audit logs, session pinning) comes from the `CF-Connecting-IP` header, which the CF edge rewrites on every inbound request — any client-supplied value is discarded before the request leaves CF. Contests have no IP gating by product design.

Three layers protect this trust boundary; **all three are required**, and losing any one collapses it:

1. **Cloud Run Ingress = "Internal and Cloud Load Balancing"** — the default `*.a.run.app` URL is rejected, so direct-to-origin is impossible. Traffic must traverse GCLB.
2. **GCLB Cloud Armor security policy** — source IP allowlist restricted to the official Cloudflare CIDR ranges (<https://www.cloudflare.com/ips-v4> + <https://www.cloudflare.com/ips-v6>). Anything else returns 403 at the LB before reaching Cloud Run.
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

## Input Validation

| Input             | Schema             | Limits                                            |
| ----------------- | ------------------ | ------------------------------------------------- |
| Source code       | `sourceCodeSchema` | 1–50,000 chars, trimmed                           |
| Slug              | `slugSchema`       | 3+ chars, `[a-z0-9-]+`                            |
| Problem statement | Markdown text      | Per-field limits (statement 12k, input/output 4k) |
| Problem images    | File upload        | png/jpeg/gif/webp, 5MB max                        |
| Testcase input    | Text               | Stored as `@db.Text`                              |
| Editorial         | `content` field    | 10–50,000 chars                                   |

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
