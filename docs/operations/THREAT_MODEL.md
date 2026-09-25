# Threat Model

Assets, attackers, trust boundaries and attack scenarios for NOJV, with the control that mitigates each and the residual risk. Controls themselves are specified once in [Security](SECURITY.md); this doc links to them rather than restating them.

## Key code

Enforcement points are listed in [Security — Key code](SECURITY.md#key-code). Security regression tests live under `tests/unit/security/` and `tests/integration/http/`.

## Security Objectives

1. Only authenticated principals act, with server-computed effective roles.
2. Untrusted code (student submissions, teacher Advanced images) cannot escape its sandbox or reach answers.
3. Source code, graded testcases, answers and session material stay with authorized readers.
4. Exam and contest results reflect honest participation.
5. Upload, proxy and storage surfaces cannot be turned against readers or internal services.

## Assets

| Asset                                   | Impact if compromised                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`                    | Session forgery; decryption of exam passwords and draft keys       |
| Session cookies                         | Full account takeover for the session lifetime                     |
| Admin / super-admin access              | Platform-wide data and role control                                |
| `DATABASE_URL`, object-storage keys     | Read/write of all data, source and testcases                       |
| Graded testcases, Advanced grade images | Grading integrity across every context                             |
| Submission source and drafts            | Privacy, academic integrity                                        |
| Exam configuration and IP records       | Exam integrity                                                     |
| OAuth client secrets, provider tokens   | Application impersonation; provider API access for linked accounts |
| Registry credentials                    | Answer-bearing image theft or replacement                          |
| Plagiarism results                      | Academic integrity data                                            |
| Worker K8s / Docker credentials         | Arbitrary workload creation                                        |

Storage locations and protections: [Security — Sensitive Data](SECURITY.md#sensitive-data).

## Trust Boundaries

```
Untrusted                    |  Trusted
                             |
Browser ---> Cloudflare -----|---> web (SvelteKit) ---> PostgreSQL, Redis, object storage, Temporal
                             |                                   |
Student code ----------------|---> sandbox Pod/container <--- worker (Temporal)
Teacher Advanced images -----|---> run / grade / service containers
Docker client (registry) ----|---> /api/registry/token ---> in-cluster registry
```

| Boundary                         | Risk     | Notes                                                                        |
| -------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Internet ↔ origin                | High     | Only via Cloudflare; client IP trust depends on it                           |
| Browser ↔ web                    | High     | All input untrusted; cookie and bearer-token auth                            |
| Student code ↔ sandbox           | Critical | Arbitrary code, highest-risk input                                           |
| Teacher image ↔ sandbox          | High     | Semi-trusted authors; grade images hold answers                              |
| Worker ↔ Docker daemon / K8s API | High     | Worker creates workloads; its credentials are privileged                     |
| Web/worker ↔ Postgres, Redis, S3 | Medium   | Internal network only; Redis unauthenticated in compose and in-cluster chart |
| Web/worker ↔ Temporal            | Low      | Internal gRPC; Temporal UI has no auth of its own                            |

## Attackers

| Attacker                  | Capabilities                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Anonymous internet client | Any HTTP request through Cloudflare; can create an OAuth account                         |
| Direct-to-origin client   | Reaches the origin without Cloudflare if exposure is misconfigured                       |
| Student                   | Signed-in session, submissions, posts, uploads, crafted API calls                        |
| Examinee                  | Student inside an exam session; wants other machines, other accounts or outside material |
| Course staff / author     | Legitimate edit access to some problems and courses; may overreach                       |
| Advanced image author     | Supplies run/grade/service images that run in the sandbox                                |
| Session or token thief    | Holds a stolen cookie, API token, backup code or mailbox                                 |
| Compromised component     | Code execution in a sandbox, worker or web pod                                           |
| Local/dev process         | Access to loopback services on a developer machine                                       |

## Assumptions

1. TLS terminates at Cloudflare (and the GKE load balancer); the app does not handle TLS.
2. Postgres, Redis, object storage and Temporal are not routable from the internet.
3. One NOJV deployment per organization; no multi-tenant isolation.
4. Cloudflare is the only ingress path in production ([Client IP Trust Model](SECURITY.md#client-ip-trust-model-cloudflare-only)).
5. The cluster CNI enforces NetworkPolicy and the `gvisor` RuntimeClass is installed; the worker verifies both at startup.
6. Runtime secrets are provisioned out of band and never committed.
7. Temporal UI is never exposed on a public interface.

## Scenarios

Each item names the mitigating control; _Residual_ is what remains.

### Edge and request boundary

- **Forged `CF-Connecting-IP` / `X-Forwarded-For` to dodge exam IP rules or rate limits** — [Client IP Trust Model](SECURITY.md#client-ip-trust-model-cloudflare-only). _Residual:_ Breaks if a non-Cloudflare origin path is ever opened.
- **Cross-site form or `fetch` against a signed-in user** — [CSRF and headers](SECURITY.md#csrf-and-headers), `sameSite: lax` cookies.
- **Clickjacking, MIME sniffing, content injection** — [CSRF and headers](SECURITY.md#csrf-and-headers) (frame-ancestors, nosniff, CSP). _Residual:_ `style-src 'unsafe-inline'` remains.
- **Oversized or chunked JSON bodies** — [Body size](SECURITY.md#body-size).
- **Request flooding (submissions, auth, uploads)** — [Rate limits](SECURITY.md#rate-limits); Temporal queue backpressure ([Reliability](RELIABILITY.md#worker-unavailable)). _Residual:_ `apiRateLimiter` falls back to per-replica memory when Redis is down; keys are per IP or per user, not per account-across-IPs.
- **Secret or internals leaked in error responses** — [Infrastructure](SECURITY.md#infrastructure) (`apiHandler` classification). _Residual:_ Zod issue paths reveal schema field names.

### Authentication and sessions

- **Credential stuffing on password sign-in** — `signInRateLimiter` / `examSignInRateLimiter`, bcrypt ([Rate limits](SECURITY.md#rate-limits)). _Residual:_ Per-IP only; distributed attempts against one account are not locked out.
- **Session cookie theft via XSS or network** — httpOnly + Secure cookies, CSP, DOMPurify ([Authentication](SECURITY.md#authentication-and-sessions), [Content](SECURITY.md#content-and-uploads)). _Residual:_ A stolen cookie is valid until revoked or expired.
- **OAuth callback replay, session fixation** — better-auth state validation and new token on sign-in.
- **Recycled school mailbox takes over the previous owner's account** — `disableImplicitLinking`; `User.email` never selects an account ([Authentication](SECURITY.md#authentication-and-sessions)).
- **Stolen session redirects security mail** — Gated `/change-email` with current-mailbox confirmation and factor unlock. _Residual:_ Accounts with no factor rely on the current-mailbox confirmation only.
- **Stolen session mints long-lived API tokens** — Fresh step-up on every token action (SEC-08).
- **Student → admin escalation** — Effective `actor.platformRole`; admin mode and super-admin proof ([Authentication](SECURITY.md#authentication-and-sessions)).
- **Stolen backup code or mailbox recovers a super admin** — Recovery requires the password first and grants setup-only access.
- **Temporary exam password used beyond the exam or for staff access** — Session marker + revision checks; staff ineligible; hard expiry at exam end.
- **`BETTER_AUTH_SECRET` leak** — Out-of-band runtime secret, never logged. _Residual:_ Leak enables session forgery and exam-password/draft-key decryption; rotation invalidates all sessions.
- **Provider token theft from the database** — Database access controls only. _Residual:_ OAuth tokens are stored unencrypted (see [Open Gaps](#open-gaps)).

### Authorization and data exposure

- **IDOR on submissions or source (`/api/submissions/[id]`, `/source`)** — `getSubmissionForActor` returns 404 for non-owners ([Authorization](SECURITY.md#authorization)).
- **Graded testcase leak through results (e.g. echo-stdin submission)** — `sanitizeStudentResult` on every student result path (SEC-12).
- **Hidden workspace file leak** — Filtered in the application layer; merged only by the worker.
- **Co-editor overreach (publish, export, other courses' submissions)** — Resource-based problem permissions with in-transaction recheck ([Authorization](SECURITY.md#authorization)).
- **Revoked staff finishing an upload started while authorized** — `lockProblemForEdit` recheck before commit.
- **Student self-enrolls or escalates course role** — Teacher-driven enrollment; TA and teacher limits in the roster transaction.
- **Canceling one's own judge to avoid the attempt limit** — Rejudge control accepts only recorded `rejudge-` workflows (SEC-13).
- **Reading editorials or discussions during a live event** — Server-resolved post context gate; exam page lock blocks post APIs.
- **Plagiarism source access by non-staff** — `assertCanManagePlagiarism`.
- **Exam page-lock bypass via other routes** — Global hook allow-list ([Exam and Contest Integrity](SECURITY.md#exam-and-contest-integrity)). _Residual:_ Second device or other browser tabs outside NOJV are not detected.

### Sandbox execution

Controls: [Sandbox Isolation](SECURITY.md#sandbox-isolation).

- **Container escape via kernel or runtime exploit** — Dropped capabilities, no-new-privileges, non-root, read-only rootfs, seccomp; gVisor on K8s. _Residual:_ Docker backend has no gVisor; it is for local/dev use.
- **Fork bomb, memory or disk exhaustion** — PID, CPU and memory limits (no swap); bounded tmpfs; ResourceQuota.
- **Output flood OOMs the worker** — 16 MB per-stream capture buffers.
- **Network exfiltration of inputs** — No network in Standard Mode; namespace deny-all NetworkPolicy. _Residual:_ Depends on CNI enforcement (probed at startup).
- **Advanced grade image leaks answers over the network** — Grade has no egress on both backends.
- **`/output` symlink pointing at answers** — `safeCopyTree` drops symlinks and special files.
- **Malicious or unpinned teacher image** — Digest pinning, registry allowlist, per-user grant, publish gate. _Residual:_ Authors with the grant are trusted not to attack their own grading.
- **Cross-teacher image theft or replacement** — Namespace-scoped registry tokens. _Residual:_ Isolation is per teacher, not per course.
- **Compromised worker creates privileged workloads** — Pod Security `restricted`, split service accounts, minimal `sandbox-job-manager` role. _Residual:_ The judge identity can still create sandbox Jobs.
- **Checker/interactor exploits run output** — Validators run in the same hardened sandbox; output treated as untrusted data.

### Uploads, Markdown and object storage

Controls: [Content and Uploads](SECURITY.md#content-and-uploads).

- **Polyglot or spoofed-type upload; SVG script** — Magic-byte check, png/jpeg/gif/webp only, `nosniff`.
- **Path traversal in storage keys or bundles** — Server-built keys; bundle path validation.
- **Stored XSS or CSS injection via Markdown / KaTeX** — DOMPurify, nonce-scoped KaTeX trust, CSP.
- **Reader tracking via remote Markdown images** — Same-origin image proxy with cache.
- **SSRF via the image proxy (private IPs, rebinding, redirects)** — Public-only DNS pinning, redirect revalidation, HTTPS/443 only.
- **Storage or bandwidth exhaustion** — Size caps, per-problem budget for author files, remote-fetch limiter, URL-keyed cache. _Residual:_ No aggregate quota for images or cached remote images.

### Exam and contest integrity

Controls: [Exam and Contest Integrity](SECURITY.md#exam-and-contest-integrity).

- **Taking the exam from another machine** — IP whitelist / first-binding with block or notify, logged violations. _Residual:_ VPN or shared NAT defeats IP-based signals; no device fingerprinting.
- **Submitting to non-exam problems from inside the exam** — Context problem-membership checks (ASM-21).
- **Submitting after close or rapid-fire submissions** — Server-side window checks; cooldown under advisory lock.
- **Reading the previous user's code on a shared lab computer** — Owner-only server drafts; per-user sealed local edits; exam drafts never adopted. _Residual:_ Unsynced local entries expose metadata (user id, context, problem); legacy v1 exam drafts remain in plaintext until cleared.
- **Seeing the live scoreboard during a freeze** — Freeze applied at read time from Postgres ([Contests](../features/contests.md#scoreboard-freeze--unfreeze)).
- **Tampering with Redis to change scores or cooldowns** — Scores and cooldowns live in Postgres; Redis only nudges (DAT-10, DAT-11). _Residual:_ Forged pub/sub nudges can trigger refetches.

### Infrastructure

Controls: [Infrastructure](SECURITY.md#infrastructure).

- **Probing health endpoints for topology** — Public probes return one boolean or the release identity; details are admin-only.
- **Reaching dev backing services from the network** — Compose binds every port to `127.0.0.1`. _Residual:_ Any local process can use unauthenticated Redis and default MinIO credentials.
- **CI or fork PR reaches production** — In-cluster Flux pull; no cluster credentials in CI; releases only from verified tags (OPS-02, OPS-04).
- **Vulnerable dependency** — [Dependency Advisories](SECURITY.md#dependency-advisories). _Residual:_ Moderate/low advisories are not gated.
- **Committed secret** — `.env` untracked; rotate on exposure.

## Criticality

| Level    | Threats                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Sandbox escape; `BETTER_AUTH_SECRET` or database credential leak; authorization bypass to admin; graded testcase or answer exposure                   |
| High     | Cross-user source access; exam integrity bypass; stored XSS; object-storage or registry credential leak; worker orchestrator abuse; OAuth secret leak |
| Medium   | Submission or SSE flooding; storage exhaustion; plagiarism-run load; Redis tampering in dev or in-cluster; Zod schema disclosure                      |
| Low      | Undetected tab/device switching; public probe disclosure; development-only defaults                                                                   |

## Open Gaps

| Gap                                         | Current state                                                                                                                               | Recommendation                                                                          | Priority |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| OAuth provider tokens stored in plaintext   | `account.encryptOAuthTokens` is not enabled                                                                                                 | Enable it (with a migration for existing rows) or stop storing tokens that are not used | Medium   |
| No aggregate image storage quota            | Images are capped per file (5 MB) and rate-limited, but not counted against any per-user or per-problem budget; remote-image cache likewise | Count image bytes in a budget if growth warrants                                        | Medium   |
| SSE concurrency caps are per replica        | `acquireSseSlot` caps 5 streams per user per stream type and 2000 per replica, in memory; SSE routes are not rate-limited                   | Move counters to Redis if a global cap is needed                                        | Low      |
| No per-account sign-in lockout              | Password sign-in is limited per IP (and per username for exam passwords)                                                                    | Add a per-account limiter if distributed brute force appears                            | Low      |
| Redis unauthenticated                       | Compose and the in-cluster chart Redis have no password; GKE uses external Redis                                                            | Add Redis auth for single-machine deployments                                           | Low      |
| Browser tab / device switching not detected | Page lock covers NOJV server routes only                                                                                                    | Only if remote proctoring becomes a requirement                                         | Low      |
| No plagiarism concurrency cap               | Dolos runs in-process per activity, bounded by one target's submissions and the activity timeout                                            | Add an activity concurrency limit if parser contention appears                          | Low      |

## Related Docs

- [Security](SECURITY.md)
- [Architecture Overview](../architecture/ARCHITECTURE.md)
- [Judge Pipeline](../architecture/JUDGE_PIPELINE.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Reliability Invariants](RELIABILITY.md)
- [Redis Architecture](../architecture/REDIS.md)
