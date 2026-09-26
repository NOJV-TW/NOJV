# Feature: Proctoring (Exam Only)

Acceptance spec for exam access controls: page lock, IP whitelist, IP binding and violation mode. All four are `Exam` fields; contests and assignments have none. Decisions: ASM-19 (server-side session lock), ASM-20 (IP rules, fail closed), SEC-09 (client IP from the trusted edge). Session lifecycle is in [Exams](exams.md).

## Key code

- `packages/application/src/shared/ip.ts` — `isIpInCidr`, `isIpInWhitelist`, `evaluateIpLock`, `checkIpLock`
- `packages/application/src/proctoring/gate.ts` — `checkProctoringGate`, `checkProctoringGateInTx` (internal `checkExamGate`, `checkContestGate`), `ProctoringDenialReason`
- `packages/application/src/proctoring/violation-logger.ts` — `logViolationThrottledInTx`
- `packages/application/src/submission/creation.ts` — gate on exam and contest submissions
- `apps/web/src/hooks.server.ts` — `enforceExamGate` (page lock, IP gate, `visibility_lost`)
- `apps/web/src/lib/server/exam-lock.ts` — `isAllowedPathForExam`, `isExamForbiddenApiRequest`, `resolveExamGateDenial`
- `apps/web/src/lib/server/shared/client-ip.ts` — `getClientIp`
- `apps/web/src/lib/components/features/course/exam/ExamProctoringTab.svelte`, `IpWhitelistField.svelte`
- `packages/core/src/types.ts` — `ipLockFields`, `ipLockFormFields`, `parseIpWhitelistText`, `ipViolationModeSchema`
- `packages/db/prisma/schema/contest.prisma` — `Exam` proctoring fields, `Participation.ipPin` / `ipGateExemptUntil`, `IpViolationLog`, `ActiveExamSession`, `ExamSessionEvent`
- Tests: `tests/unit/application/ip-utils.test.ts`, `proctoring-gate.test.ts`, `exam-session.test.ts`, `exam-session-mutations.test.ts`, `submission-mutations-boundaries.test.ts`; `tests/unit/db/participation-ip-pin.test.ts`; `tests/unit/web/exam-lock.test.ts`; `tests/unit/security/exam-confinement-api-allowlist.test.ts`; `tests/unit/core/schemas.test.ts` (whitelist parser)

Out of scope: contest or assignment IP rules, course-wide or per-problem locks, remote proctoring (webcam, screen recording, lockdown browser), detecting tab/window switches, fullscreen changes or navigation outside NOJV.

## Acceptance criteria

### Page lock

The global hook reads the user's active session and the exam's current `pageLockEnabled` on every authenticated request, so setting changes apply to the next request. If the active-session lookup or the gate check throws, the request fails closed with 503.

- `pageLockEnabled: true`, request outside `/exams/[examId]` (not an API path, not `/signin` or `/signout`): record `visibility_lost` with `metadata.attemptedPath`, then redirect 307 to `/exams/[examId]`. A failing event write logs a warning and still redirects.
- `pageLockEnabled: true`, API requests: `/api/contests/*`, `/api/posts/*`, `/api/comments/*`, `/api/problems/[id]/posts` and submission endpoints other than `GET`/`POST /api/submissions`, `GET /api/submissions/[id]` and `GET /api/submissions/[id]/source` return 403 `exam_api_scope`.
- `pageLockEnabled: false`: requests outside the exam proceed under normal authorization and the session stays active; the hook runs the IP gate only on exam paths.
- Exam pages and exam submissions always enforce membership, time window and IP rules, whatever the page-lock setting. An IP denial returns 403 `exam_ip_blocked`; on API paths, `not_enrolled`, `course_archived`, `not_published` and `not_found` return 403 `exam_<reason>`.

### Composite gate

- `checkExamGate` returns `{ ok: true }` when the exam exists, is published, the user has an active membership, the course is not archived, `startsAt - grace <= now < endsAt`, and IP checks pass (IP checks run only when an IP is supplied).
- Denial reasons: `not_found`, `not_published`, `not_enrolled`, `course_archived`, `not_started`, `ended`, `ip_whitelist`, `ip_binding`.
- `checkContestGate` checks only existence, `published` visibility and the time window.

### IP whitelist

- `ipWhitelistEnabled: true`: the client IP must match a CIDR in `ipWhitelist`. An empty list matches nothing, so every request is a violation (fail closed).
- `ipWhitelistEnabled: false`: the list is ignored.
- CIDR matching uses `net.BlockList`: IPv4, native IPv6 and v4-mapped IPv6 (compared as IPv4). A CIDR without a prefix matches that host only; `/0` matches everything. Malformed CIDRs (`/33`, `/-1`, `/129`, missing IP, non-numeric, family mismatch) never match and never throw.
- The settings field accepts newline, CSV, semicolon or whitespace-separated lists and file import; duplicates are removed. Limits: 1000 entries, 50 characters per CIDR, 50,000 characters of text.

### IP binding

- `ipBindingEnabled: true` and no `ipPin` on the exam participation: the current IP is pinned with a conditional write (`ipPin IS NULL`) and the request is allowed. Later requests from another IP are binding violations.
- Concurrent first requests from different IPs: exactly one conditional write wins; the loser re-reads the pin and is evaluated as a binding violation against the winner's IP (allowed if it has the same IP).
- Exam entry runs the gate before creating the session, so a blocked entry creates no session ([Exams — Session start](exams.md#session-start)).
- No participation row: binding is skipped.
- `resetStudentIpBinding` (course staff) clears the pin and sets `ipGateExemptUntil` to now + 10 minutes; during the exemption IP checks pass and the next request re-pins.

### Violation mode and logging

- `block`: a violation denies the request (`ip_whitelist` or `ip_binding`). `notify`: it is allowed.
- In both modes a violation writes an `IpViolationLog` row, throttled to one per (exam, user, violation type) per 60 seconds. Denied exam entries and denied exam submissions commit the transaction holding the gate's writes and raise the denial afterwards, so the row survives the rejection.
- Row fields: `userId`, `examId` (both cascade on delete), `violationType` (`whitelist | binding`), `actualIp`, `expectedIp` (joined whitelist for whitelist violations, the pin for binding violations), `createdAt`.
- Mode changes apply from the student's next request.
- Managers see the log and active sessions in the exam's Proctoring tab.

### Client IP

- Production uses only `CF-Connecting-IP`; a missing or invalid header is 403. There is no `X-Forwarded-For` fallback. The origin accepts only Cloudflare traffic (OPS-08; setup in [Deployment](../operations/DEPLOYMENT.md)).
- Non-production accepts an `x-dev-ip` override, else the socket address.
- The IP is resolved in the web layer; `checkIpLock` receives a string.
