# Security Threat Model

## 1. Overview

NOJV is an Online Judge platform supporting competitive programming contests (ICPC/IOI scoring), course-based assessments, practice submissions, and plagiarism detection. The runtime consists of a SvelteKit BFF (server-rendered frontend), a Temporal-backed worker for submission judging and lifecycle orchestration, Docker/Kubernetes sandbox containers for untrusted code execution, PostgreSQL as the durable source of truth, Redis for cache/pub-sub/scoreboards/rate-limiting, and S3-compatible object storage for problem images.

### Core Security Objectives

1. Ensure only authenticated principals act — every privileged route requires a valid session
2. Enforce local RBAC (admin/teacher/student) on every privileged action
3. Isolate untrusted student code execution from the host system
4. Protect submission source code, hidden testcases, and session material
5. Preserve contest integrity (anti-cheat: IP binding, page lock, cooldown)
6. Keep image upload and object storage surfaces narrowly scoped

## 2. Assets, Trust Boundaries, and Assumptions

### Sensitive Assets

| Asset                   | Location                                                        | Sensitivity                                                   |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Session tokens          | PostgreSQL `Session` table, httpOnly cookies                    | Critical — session hijack grants full account access          |
| OAuth credentials       | PostgreSQL `Account.accessToken`, encrypted by better-auth      | Critical — provider account linkage                           |
| User passwords          | PostgreSQL `Account.password`, bcrypt-hashed                    | Critical — credential theft                                   |
| Student source code     | PostgreSQL `Submission.sourceCode`                              | High — per-user access control, intellectual property         |
| Graded testcases        | PostgreSQL `TestcaseSet` / `Testcase` (all rows, graded only)   | High — exposure undermines all grading                        |
| Hidden workspace files  | PostgreSQL `ProblemWorkspaceFile` (`visibility = hidden`)       | High — test harness and library code kept out of student view |
| Advanced judge tarballs | S3 bucket `problems/{problemId}/advanced-images/{uuid}.tar`     | Medium — teacher-only write, worker-only read at judge time   |
| Problem images          | S3 bucket `problems/{problemId}/images/{uuid}.{ext}`            | Medium — public read, teacher-only write                      |
| Contest configuration   | PostgreSQL `Contest` (freeze time, scoring weights, IP binding) | High — manipulation breaks contest integrity                  |
| Database credentials    | `DATABASE_URL` env var                                          | Critical — full data access                                   |
| S3 credentials          | `S3_ACCESS_KEY`, `S3_SECRET_KEY` env vars                       | High — storage read/write                                     |
| `BETTER_AUTH_SECRET`    | Environment variable                                            | Critical — session forgery if leaked                          |
| OAuth client secrets    | `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` env vars         | High — OAuth impersonation                                    |
| Plagiarism reports      | PostgreSQL `PlagiarismReport.results` JSON                      | Medium — academic integrity data                              |
| Course join tokens      | PostgreSQL `CourseJoinToken`                                    | Medium — unauthorized enrollment                              |

### Primary Trust Boundaries

```
Untrusted          |  Trusted
                   |
Browser -----------|---> SvelteKit Server ---> PostgreSQL
                   |         |
Student Code ------|---> Sandbox Container     Redis
                   |         |                 Temporal
                   |    Docker / K8s           S3 Storage
```

| Boundary                           | Risk Level | Notes                                                                        |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Browser <-> SvelteKit Server       | High       | All user input is untrusted. Zod schemas validate every field.               |
| Student Code <-> Sandbox Container | Critical   | Arbitrary code is the highest-risk input. Full container isolation required. |
| Server <-> PostgreSQL              | Low        | Prisma parameterized queries. Internal network.                              |
| Server <-> Redis                   | Low        | Internal network. No authentication in development.                          |
| Server <-> S3 Storage              | Medium     | Credentials required. Problem images are publicly readable.                  |
| Server <-> Temporal                | Low        | Trusted internal orchestrator. gRPC on internal network.                     |
| Worker <-> Docker Daemon / K8s API | High       | Worker creates sandbox containers. Daemon access is privileged.              |

### Exposed Route Families

**Auth routes (public):**

| Route                 | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `/signin`             | Sign in (email/password, GitHub, Google)             |
| `/admin-signin`       | Admin-specific sign in                               |
| `/complete-profile`   | Onboarding: username, email verification             |
| `/verify-school`      | School email verification                            |
| `/api/auth/[...path]` | better-auth catch-all (session, OAuth, registration) |

**Authenticated API routes:**

| Route                                      | Methods   | Auth                                                     |
| ------------------------------------------ | --------- | -------------------------------------------------------- |
| `/api/submissions`                         | POST      | `requireApiAuth` + rate limiter                          |
| `/api/submissions/[id]`                    | GET       | `requireApiAuth` + ownership check                       |
| `/api/submissions/[id]/source`             | GET       | `requireApiAuth` + ownership or admin                    |
| `/api/submissions/[id]/stream`             | GET       | `getActorContext` + ownership or admin                   |
| `/api/events/stream`                       | GET       | `getActorContext` + `hasActorUsername`                   |
| `/api/contests/[slug]/scoreboard`          | GET       | Optional auth (privileged view for admin/teacher)        |
| `/api/contests/[slug]/scoreboard/unfreeze` | POST      | `requireApiAuth` + `requirePlatformRole(admin, teacher)` |
| `/api/plagiarism/[assessmentId]`           | GET, POST | `requireApiAuth` + `canManageCourse(role)`               |
| `/api/problems/[id]/editorials`            | GET, POST | `requireApiAuth` + AC-gated for students                 |
| `/api/problems/[id]/images`                | POST      | `requireApiAuth` + `canEditProblem(platformRole)`        |
| `/api/problems/create`                     | POST      | `requireApiAuth` + `requirePlatformRole(admin, teacher)` |
| `/api/ip-violations`                       | GET       | `requireApiAuth` + admin/teacher                         |
| `/api/healthz`                             | GET       | Public, no auth                                          |

**Authenticated page routes (layout-gated):**

All routes under `(app)/` require authentication via `requireAuth(event)` in `+layout.server.ts`. Admin routes (`/admin/*`) additionally require `requirePlatformRole(actor, "admin")`. Course management routes (`/courses/[slug]/manage/*`) require `canManageCourse(role)`.

### Attacker-Controlled Inputs

| Input                 | Entry Point                               | Validation                                    |
| --------------------- | ----------------------------------------- | --------------------------------------------- |
| Source code           | `POST /api/submissions` body              | `submissionDraftSchema` (Zod), 1-50,000 chars |
| Problem statements    | Form actions on problem create/edit       | Zod per-field limits, markdown text           |
| Testcase input/output | Form actions on problem edit              | Zod, stored as `@db.Text`                     |
| Image file upload     | `POST /api/problems/[id]/images` formData | Type whitelist, 5 MB limit                    |
| URL slugs             | Route params (`[slug]`, `[id]`)           | `slugSchema` (3+ chars, `[a-z0-9-]+`)         |
| OAuth callback params | `/api/auth/[...path]`                     | better-auth validates state/code              |
| Contest invite codes  | Form action on contest join               | Zod validation                                |
| Course join tokens    | `/courses/[slug]/join/[token]` URL param  | Token lookup in DB                            |
| Editorial content     | `POST /api/problems/[id]/editorials`      | Zod, 10-50,000 chars                          |
| IP addresses          | `event.getClientAddress()`                | Trusted from reverse proxy, not user-supplied |
| User-Agent / headers  | HTTP headers                              | Logged per session, not validated             |
| Query parameters      | Various GET endpoints                     | Parsed per-route                              |

### Assumptions

1. **TLS termination** happens at the load balancer or reverse proxy (Cloud Run, nginx). The application does not handle TLS directly.
2. **Internal network** between SvelteKit, PostgreSQL, Redis, Temporal, and S3 is not routable from the public internet in production.
3. **Single-tenant deployment** — one NOJV instance per organization. No multi-tenant isolation concerns.
4. **Reverse proxy provides** `X-Forwarded-For` — `event.getClientAddress()` returns the real client IP.
5. **Docker daemon access** on the worker host is restricted to the worker process. In production, Kubernetes RBAC limits the worker's service account to sandbox job creation only.
6. **Secrets management** — production uses GCP Secret Manager. Development uses `.env` (untracked).
7. **Redis has no authentication** in development. Production uses Memorystore with VPC-only access.

## 3. Attack Surface, Mitigations, and Attacker Stories

### 3.1 Authentication and Sessions

**Surface:** `/signin`, `/admin-signin`, `/api/auth/[...path]`, OAuth callbacks (GitHub, Google)

**Mitigations:**

- better-auth manages session lifecycle, token rotation, and OAuth state validation
- Passwords hashed with bcrypt via better-auth
- Session tokens transported as httpOnly, Secure (in production) cookies
- IP address and user-agent tracked per session in PostgreSQL `Session` table
- Session expiry enforced server-side
- Profile completion gate: `hasActorUsername(actor)` required before accessing content
- `hooks.server.ts` resolves session on every request via `auth.api.getSession()`

**Attacker stories:**

- **Credential stuffing**: Attacker tries common password lists against `/api/auth/[...path]`. _Mitigation_: `apiRateLimiter` (60 req/min per IP) on all API routes. bcrypt cost factor slows brute force.
- **Session hijack via cookie theft**: XSS or network interception steals session cookie. _Mitigation_: httpOnly prevents JS access. Secure flag in production enforces HTTPS. Session IP/UA tracking enables anomaly detection.
- **OAuth callback replay**: Attacker captures and replays OAuth authorization code. _Mitigation_: better-auth validates `state` parameter and uses single-use authorization codes per OAuth spec.
- **Session fixation**: Attacker pre-sets a session token before victim authenticates. _Mitigation_: better-auth generates new session token on successful authentication.
- **`BETTER_AUTH_SECRET` leakage**: Attacker reads secret from exposed `.env` or logs. _Mitigation_: `.env` is gitignored. Production secrets stored in GCP Secret Manager. Secret never logged.

### 3.2 API Authorization and Role Enforcement

**Surface:** All `/api/*` routes and SvelteKit form actions

**Mitigations:**

- `requireApiAuth(event)` on every API route — returns `CompletedActorContext` or throws 401/403
- `requireAuth(event)` on every page server load — redirects unauthenticated users
- `requirePlatformRole(actor, ...roles)` gates admin/teacher-only actions (throws `ForbiddenError` / 403)
- `canEditProblem(platformRole)` checks admin or teacher for problem CRUD
- `canManageCourse(effectiveRole)` checks admin, teacher, or TA for course management
- `resolveEffectiveCourseRole(platformRole, courseRole)` merges platform and course roles (admin overrides all)
- `getSubmissionForUser(submissionId, userId, isAdmin)` enforces ownership on submission access
- `apiHandler()` wraps all API routes with error classification — domain errors mapped to proper HTTP status codes, no stack traces in responses

**Attacker stories:**

- **Privilege escalation (student -> admin)**: Student manipulates request to access admin endpoints. _Mitigation_: `requirePlatformRole(actor, "admin")` checks server-side role from session, not from request body. Role is read from `event.locals.sessionUser.platformRole`, set during session resolution in hooks.
- **IDOR on submissions**: Student accesses another student's submission by guessing submission ID. _Mitigation_: `getSubmissionForUser()` checks `submission.userId === userId` unless `isAdmin` is true. Returns 404 on mismatch.
- **IDOR on source code**: Student reads another's source code via `/api/submissions/[id]/source`. _Mitigation_: Same ownership check as above — `getSubmissionForUser(submissionId, userId, isAdmin)`.
- **Course role bypass**: Student accesses course management without enrollment. _Mitigation_: `resolveCoursePermission(courseSlug, actor)` queries `CourseMembership` from DB. `canManageCourse()` requires admin, teacher, or TA effective role.
- **Unauthorized problem modification**: Student attempts to create/edit problems. _Mitigation_: `canEditProblem(platformRole)` requires admin or teacher. Checked server-side on every problem mutation endpoint.

### 3.3 Submission and Sandbox Execution

**Surface:** `POST /api/submissions`, sandbox container (Docker/Kubernetes)

**Mitigations:**

- Container hardening: `cap-drop ALL`, `no-new-privileges`, read-only rootfs, `tmpfs /tmp` only
- Network isolation: `--network none` (default, configurable per-problem)
- Resource limits: CPU (default 1 core), memory (default 256 MB, max 1024 MB), PID limit (default 64)
- seccomp profile restricts system calls
- Sandbox-runner depends only on `@nojv/core` — minimal attack surface
- Source code validated by `submissionDraftSchema` (1-50,000 chars)
- Temporal workflow ID is deterministic (`judge-{submissionId}`) — duplicate dispatches are idempotent
- `writeApiRateLimiter` (10 req/min per IP) on submission endpoint
- Submit cooldown via Redis `SET NX EX` for contest submissions
- Static analysis stage can ban dangerous functions/imports/patterns before execution
- Temporal retries (3 attempts) for transient sandbox failures

**Attacker stories:**

- **Container escape**: Malicious code exploits kernel vulnerability to escape sandbox. _Mitigation_: `cap-drop ALL` removes all Linux capabilities. `no-new-privileges` prevents escalation. seccomp restricts syscalls. Read-only rootfs limits persistence. In production, Kubernetes Jobs run in a dedicated namespace with NetworkPolicy and ResourceQuota.
- **Fork bomb / resource exhaustion**: Code spawns processes to consume host resources. _Mitigation_: PID limit (64) caps process count. Memory limit (256 MB default) caps RAM. CPU limit caps compute. Container killed on limit breach.
- **Network exfiltration**: Code sends hidden testcase data to external server. _Mitigation_: `--network none` blocks all network access by default. When network is enabled per-problem, firewall rules whitelist specific hosts/ports only. Traffic is logged.
- **Filesystem escape**: Code reads sensitive files on host filesystem. _Mitigation_: Read-only rootfs. Only `/tmp` (tmpfs) is writable. No host volume mounts. Container runs as non-root.
- **Compiler/runtime exploit**: Malicious source exploits compiler or runtime vulnerability. _Mitigation_: Compilation runs inside the same sandboxed container. seccomp profile limits available syscalls.
- **Submission flooding**: Attacker submits thousands of requests to overwhelm sandbox workers. _Mitigation_: `writeApiRateLimiter` (10/min per IP). Contest cooldown via Redis. Temporal task queue provides natural backpressure. KEDA scales workers based on queue depth.
- **Sandbox output manipulation**: Code produces output designed to exploit the checker. _Mitigation_: Checker scripts also run inside sandbox with same isolation. Output is treated as untrusted data throughout the pipeline.

### 3.4 Image Upload and Object Storage

**Surface:** `POST /api/problems/[id]/images`

**Mitigations:**

- `requireApiAuth(event)` — must be authenticated
- `canEditProblem(actor.platformRole)` — admin or teacher only
- File type whitelist: `image/png`, `image/jpeg`, `image/gif`, `image/webp` (checked against `file.type`)
- Size limit: 5 MB per file
- UUID filenames: `problems/{problemId}/images/{uuid}.{ext}` — no user-controlled path components
- Images stored in S3-compatible storage (Garage local, GCS/R2/S3 production)
- URLs embedded as markdown image syntax in problem statements

**Attacker stories:**

- **Malicious file upload (polyglot)**: Attacker uploads a file with valid image header but embedded script. _Mitigation_: Type whitelist checks MIME type. UUID filenames prevent path guessing. Images served from a separate S3 origin, not the application domain (reduces XSS risk).
- **Path traversal**: Attacker manipulates `problemId` to write files outside the intended directory. _Mitigation_: `problemId` comes from URL route param (CUID format). Storage path is constructed server-side: `problems/{problemId}/images/{uuid}.{ext}`. No user-supplied path segments.
- **Storage exhaustion**: Attacker uploads many large images to fill storage. _Mitigation_: 5 MB per file. `requireApiAuth` + `canEditProblem` limits uploaders to admin/teacher. `writeApiRateLimiter` limits upload rate. _Gap_: No per-problem or per-user storage quota.
- **XSS via SVG**: SVG files can contain JavaScript. _Mitigation_: SVG is not in the allowed type list (`image/svg+xml` is rejected). Only `png`, `jpeg`, `gif`, `webp` are accepted.
- **S3 credential exposure**: Attacker accesses S3 keys to read/write arbitrary objects. _Mitigation_: Credentials in environment variables, not in code. Production uses GCP Secret Manager. `.env` is gitignored.

### 3.5 Contest Integrity

**Surface:** Contest submission, scoreboard, participation, IP binding

**Mitigations:**

- **IP binding (exam only)**: When `Exam.ipBindingEnabled`, first request records `ExamParticipation.ipPin`. Subsequent requests from different IPs are blocked or logged based on violation mode (`block`/`notify`). Violations stored in `IpViolationLog` table. Contests have no IP binding — they're public CP events.
- **IP whitelist**: When `ipWhitelistEnabled`, only whitelisted IPs can participate.
- **Page lock**: When `pageLockEnabled`, JavaScript visibility API prevents opening new tabs. Violations detected client-side.
- **Submit cooldown**: Redis `SET NX EX` prevents rapid-fire submissions. Configurable per-contest (`submitCooldownSec`). Cross-instance consistent.
- **Scoreboard freeze**: `RENAME` creates a frozen snapshot in Redis. Public reads go to `:frozen` key. Admin/teacher see the live key. Final scores always computed from PostgreSQL.
- **Allowed languages**: Contest can restrict which languages are accepted.
- **Max attempt limits**: Configurable per-contest.

**Attacker stories:**

- **Multi-account cheating**: Student uses multiple accounts to submit from different "identities". _Mitigation_: IP binding detects same-IP multi-account. Admin can view IP violation logs via `/api/ip-violations`. _Gap_: No device fingerprinting beyond IP. VPN/proxy can bypass IP binding.
- **IP spoofing**: Attacker forges IP to bypass IP binding. _Mitigation_: In production the only trusted source is Cloudflare's `CF-Connecting-IP` header (CF edge overwrites any client-supplied value before the request leaves CF). Cloud Run Ingress = "Internal and Cloud Load Balancing" + GCLB Cloud Armor CIDR allowlist restrict ingress to CF's published IP ranges, so direct-to-origin requests carrying a forged `CF-Connecting-IP` cannot reach the app. `X-Forwarded-For` is **never** trusted — `getClientIp(event)` refuses to fall back to it. See [SECURITY.md — Client IP Trust Model](SECURITY.md#client-ip-trust-model-cloudflare-only).
- **Submission flooding during contest**: Attacker floods submissions to degrade service for other participants. _Mitigation_: `writeApiRateLimiter` (10/min per IP). Contest `submitCooldownSec` via Redis. Rate limit is per-IP, cross-instance.
- **Scoreboard manipulation**: Attacker modifies Redis sorted set directly. _Mitigation_: Redis is on internal network only, not publicly accessible. Scores are always verified against PostgreSQL on final computation.
- **Page lock bypass**: Student disables JavaScript or uses a non-browser client. _Mitigation_: Page lock is client-side enforcement (JavaScript visibility API). It is a deterrent, not a hard guarantee. _Gap_: Determined attacker can bypass with custom HTTP client.
- **Contest timing attack**: Student submits after contest ends. _Mitigation_: `closesAt` timestamp checked server-side before accepting submissions. Temporal `contestLifecycleWorkflow` manages state transitions with durable timers.

### 3.6 Real-Time Events (SSE)

**Surface:** `GET /api/events/stream`, `GET /api/submissions/[id]/stream`

**Mitigations:**

- `/api/events/stream`: `getActorContext(event)` + `hasActorUsername(actor)` — returns 401 if unauthenticated. Each user subscribes only to their own Redis channel (`user:{userId}`).
- `/api/submissions/[id]/stream`: `getActorContext(event)` + ownership check via `getSubmissionForUser(submissionId, userId, isAdmin)`.
- Max connection duration: 10 minutes (`MAX_DURATION_MS = 600_000`), then auto-close.
- Keepalive pings every 30 seconds to detect dead connections.
- Separate Redis subscriber connection per SSE stream (avoids blocking main connection).
- Client disconnect cleanup via `event.request.signal.addEventListener("abort", cleanup)`.

**Attacker stories:**

- **Unauthorized event access**: Attacker subscribes to another user's event stream. _Mitigation_: Channel name is `user:{userId}` where `userId` comes from the authenticated session. Attacker cannot control which channel they subscribe to.
- **SSE connection flooding**: Attacker opens thousands of SSE connections to exhaust server resources. _Mitigation_: Each connection creates a Redis subscriber. 10-minute auto-close limits duration. `apiRateLimiter` (60/min per IP) on all API routes. _Gap_: No explicit per-user SSE connection limit. A single authenticated user could open many concurrent SSE connections.
- **Submission stream eavesdropping**: Attacker polls another user's submission stream to infer verdicts. _Mitigation_: `getSubmissionForUser()` checks ownership before returning any data. Unauthorized access returns an error and closes the stream.

### 3.7 Problem and Course Management

**Surface:** Problem CRUD (create, edit, testcases, templates), course management (members, assessments, progress, grades)

**Mitigations:**

- Problem creation/editing: `requirePlatformRole(actor, "admin", "teacher")` or `canEditProblem(platformRole)`
- Course management: `canManageCourse(effectiveRole)` requires admin, teacher, or TA effective role
- All input validated with Zod schemas from `@nojv/core`
- Course join via token: token must exist in `CourseJoinToken` table and be valid
- Assessment lifecycle: Temporal workflow manages `opensAt` -> `dueAt` -> `closesAt` transitions server-side
- Grade export: restricted to course staff via `canManageCourse`

**Attacker stories:**

- **Unauthorized problem modification**: Student modifies a problem's testcases to make their submission pass. _Mitigation_: `canEditProblem()` requires admin or teacher. Problem edit page checks role in `+page.server.ts`.
- **Graded testcase leak**: Student accesses graded testcase content. _Mitigation_: `TestcaseSet` / `Testcase` rows are never included in student-facing responses — only `Problem.samples` (a separate JSON column scoped to presentation) is rendered on the problem page. `ProblemDetail` in the domain layer deliberately excludes testcase set content before returning to the web layer.
- **Hidden workspace file leak**: Student reads a `ProblemWorkspaceFile` whose `visibility = hidden` (e.g., internal test harness). _Mitigation_: `mapPersistedProblemDetail` in `packages/domain/src/problem/queries.ts` filters out `visibility === "hidden"` before the row leaves the domain layer. Hidden files are only merged into the sandbox workspace by the worker at judge time.
- **Assessment manipulation**: Student modifies assessment deadlines or configuration. _Mitigation_: Assessment mutations require `canManageCourse(role)`. Deadline enforcement is server-side (`closesAt` checked before accepting submissions).
- **Course join token brute force**: Attacker guesses join tokens to enroll in courses. _Mitigation_: Tokens are generated server-side with sufficient entropy. URL path `/courses/[slug]/join/[token]` requires the exact token. _Gap_: No explicit rate limit on join token attempts beyond the general form rate limiter (20/min per IP).
- **Grade export data exposure**: Student accesses another course's grade export. _Mitigation_: `resolveCoursePermission(courseSlug, actor)` checks course membership and role before allowing export.

### 3.8 Plagiarism Detection

**Surface:** `POST /api/plagiarism/[assessmentId]`, `GET /api/plagiarism/[assessmentId]`

**Mitigations:**

- `requireApiAuth(event)` on both GET and POST
- `canManageCourse(role)` restricts to admin, teacher, or TA
- `writeApiRateLimiter` (10/min per IP) on POST
- Temporal workflow processes detection asynchronously
- `PlagiarismReport` record created in DB before workflow dispatch (duplicate-safe)

**Attacker stories:**

- **False plagiarism reports**: Attacker triggers plagiarism check repeatedly to generate noise. _Mitigation_: Only course staff can trigger. Rate limited. Report record prevents duplicate workflows for the same target.
- **Worker resource exhaustion via plagiarism floods**: Attacker triggers many detection runs to load tree-sitter parsers and exhaust worker CPU/memory. _Mitigation_: Rate limiter on POST. Course staff restriction limits the pool of potential abusers. Dolos runs in-process with bounded inputs (one assessment's submissions), capped by the activity's 10-minute timeout.
- **Source code leakage via plagiarism endpoint**: Attacker uses `source=true` query param to read arbitrary student code. _Mitigation_: `canManageCourse(role)` gate. Only course staff can access. `userId` and `problemId` params required — returns code only for the target assessment's submissions.

### 3.9 Infrastructure and Configuration

**Surface:** Deployment config, environment variables, Docker Compose, health endpoints, CI/CD

**Mitigations:**

- `.env` untracked in git (gitignored)
- Production secrets stored in GCP Secret Manager
- Health endpoints (`/api/healthz`, worker `/healthz`) return minimal information (`{ ok: true }`)
- `apiHandler()` catches all errors — unhandled errors logged server-side, only `classified.message` returned to client (no stack traces)
- Docker Compose services on internal Docker network (Temporal, PostgreSQL, Redis not exposed to public)
- Cloud Build CI validates formatting, linting, types, and tests before deployment
- Deployment via CD workflow triggered only on CI success for `main` branch
- Self-hosted runner uses `.env` loaded during preflight (not committed to repo)

**Attacker stories:**

- **Secret leakage via error messages**: Application error exposes database URL or auth secret in response. _Mitigation_: `apiHandler()` classifies errors and returns only safe messages. `logger.error()` logs full details server-side only. ZodError responses include validation issues (field paths and messages) but no internal state.
- **Exposed admin endpoints**: Health check or admin routes accessible without auth. _Mitigation_: `/api/healthz` is intentionally public but returns only `{ ok: true }`. Admin routes require `requirePlatformRole(actor, "admin")`. Temporal UI (port 8080) should be firewalled in production.
- **Misconfigured CORS**: API endpoints accessible from arbitrary origins. _Mitigation_: SvelteKit handles CORS via its built-in mechanisms. Same-origin by default for form actions.
- **Docker daemon exposure**: Attacker accesses Docker socket to create privileged containers. _Mitigation_: In production, sandbox runs as Kubernetes Jobs with dedicated service account. Worker's K8s RBAC is scoped to sandbox namespace only. In development, Docker socket access is local.
- **CI/CD pipeline compromise**: Attacker injects malicious code via pull request. _Mitigation_: CD deploys only from `main` branch after CI passes. Self-hosted runner workspace is persistent. Clean checkout uses exact CI-passing SHA.
- **Redis data poisoning**: Attacker writes to Redis to manipulate scoreboards or bypass cooldown. _Mitigation_: Redis is on internal network only. No public port exposure. In production, Memorystore is VPC-only. _Gap_: No Redis authentication in development — any process on the dev machine can access Redis.
- **Local Garage credential exposure**: Development uses Garage S3 credentials generated by `scripts/bootstrap-garage.sh` and written to `.env`. _Mitigation_: Development only. Production uses GCS/R2/S3 with credentials from Secret Manager.

## 4. Criticality Calibration

### Critical

| Threat                                                   | Justification                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sandbox escape or container breakout                     | Arbitrary code execution on host. Full system compromise.                                      |
| Authentication bypass or session forgery                 | `BETTER_AUTH_SECRET` leak enables session token forgery for any user.                          |
| Authorization bypass (student accessing admin functions) | Platform role checked from session — bypass requires auth subsystem flaw.                      |
| Hidden testcase exposure                                 | Undermines all grading integrity across contests and courses.                                  |
| Database compromise                                      | `DATABASE_URL` leak gives read/write to all data: passwords, sessions, source code, testcases. |

### High

| Threat                                                                   | Justification                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Source code access across users (IDOR)                                   | Privacy violation. Intellectual property exposure. Competition integrity.                            |
| Contest integrity violation (IP binding bypass, submission manipulation) | Undermines fairness of competitive events and graded assessments.                                    |
| XSS via markdown rendering or user content                               | Session cookie is httpOnly (limits impact), but DOM manipulation and phishing remain possible.       |
| S3 credential exposure                                                   | Read/write to all problem images. Could replace images with malicious content.                       |
| Docker daemon / K8s API abuse                                            | Worker has privileged access to create containers. Compromise enables arbitrary container execution. |
| OAuth secret leakage                                                     | Attacker could impersonate the application in OAuth flows.                                           |

### Medium

| Threat                                         | Justification                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| DoS via submission flooding                    | Rate limiters and Temporal backpressure mitigate, but sustained attack could degrade service. |
| SSE connection exhaustion                      | No per-user SSE connection limit. Many concurrent connections could exhaust server memory.    |
| Image storage exhaustion                       | No per-problem/per-user storage quota. Teachers could fill storage with large uploads.        |
| Information leakage from Zod validation errors | Validation issue responses include field paths — reveals internal schema structure.           |
| Plagiarism detection abuse (worker load)       | Repeated triggers load tree-sitter parsers and consume worker CPU/memory in-process.          |
| Redis data manipulation (development)          | No Redis auth in dev. Any local process can read/write cache, scoreboards, cooldowns.         |
| Course join token brute force                  | General rate limiter (20/min) but no token-specific lockout.                                  |

### Low

| Threat                                 | Justification                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Page lock bypass                       | Client-side deterrent only. No server-side enforcement possible for tab switching. |
| Verbose Zod error messages             | Field paths exposed, but no secrets or internal state.                             |
| Development-only insecure defaults     | Local Garage credentials in `.env`, Redis no-auth — development environment only.  |
| Health endpoint information disclosure | Returns only `{ ok: true }` / `{ status: "ok" }` — minimal exposure.               |

## 5. Open Gaps and Recommendations

| #   | Gap                                                 | Current State                                                                              | Recommendation                                                                              | Priority |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------- |
| 1   | No per-user SSE connection limit                    | Any authenticated user can open unlimited SSE streams                                      | Add a per-user concurrent connection counter in Redis; reject above threshold               | Medium   |
| 2   | No per-problem/per-user storage quota               | Teachers can upload unlimited 5 MB images                                                  | Track upload count/size per problem; enforce a reasonable ceiling                           | Medium   |
| 3   | Rate limiter is in-memory in current implementation | `RateLimiterMemory` does not share state across SvelteKit instances                        | Migrate to `RateLimiterRedis` for cross-instance consistency (as documented in SECURITY.md) | High     |
| 4   | Redis unauthenticated in development                | Any local process can access Redis                                                         | Acceptable for development. Ensure production uses VPC-restricted Memorystore               | Low      |
| 5   | Page lock is client-side only                       | Determined attacker can bypass with custom HTTP client                                     | Document limitation. Consider logging tab-visibility violations server-side as evidence     | Low      |
| 6   | No CSRF token on API routes                         | SvelteKit form actions have built-in CSRF. API routes rely on same-origin and auth headers | Verify `Origin` header checking is active on all mutation endpoints                         | Medium   |
| 7   | File type validation uses `file.type`               | MIME type is client-reported and can be spoofed                                            | Add magic-number (file header) validation for uploaded images                               | Medium   |
| 8   | Temporal UI exposed in development                  | Port 8080 accessible on localhost                                                          | Ensure Temporal UI is not publicly accessible in production (firewall or VPN)               | High     |
| 9   | Plagiarism concurrency cap                          | No per-worker cap on concurrent Dolos runs                                                 | Add a semaphore / Temporal activity concurrency limit if operator sees parser contention    | Low      |
| 10  | No account lockout on failed login                  | bcrypt slows brute force but no explicit lockout                                           | Consider temporary account lockout after N failed attempts                                  | Medium   |

## Related Docs

- [Security Requirements](SECURITY.md)
- [Architecture Overview](../ARCHITECTURE.md)
- [Judge Pipeline](JUDGE_PIPELINE.md)
- [Frontend Surface](FRONTEND.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Reliability Invariants](RELIABILITY.md)
- [Redis Architecture](REDIS.md)
