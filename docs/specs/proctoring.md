# Feature: Proctoring (Exam-Only)

Acceptance spec for the proctoring controls that gate exam access and
logging. Proctoring is a composite of four mechanisms:

1. **Page lock** — active exam session traps the user on `/exams/[examId]`.
2. **IP whitelist** — configured CIDR ranges must contain the client IP.
3. **IP binding** — pin to the first-seen client IP for the duration.
4. **Violation mode** — `block` rejects requests, `notify` logs and allows.

All four live on `Exam` ONLY. Contests and homework assignments have no
proctoring (see `docs/specs/contests.md` and
`docs/specs/assignments.md`).

## User Stories

- As a **teacher / TA**, I want to toggle `pageLockEnabled`,
  `ipWhitelistEnabled` (+ CIDR list), and `ipBindingEnabled` per exam,
  so that each exam's seating / network policy is captured with the
  exam row.
- As a **teacher**, I want `ipViolationMode: notify` for exams where I
  want a rough audit trail without interrupting students, and
  `ipViolationMode: block` for high-stakes exams that must be hard-gated.
- As a **student** in a proctored exam, I want page lock to redirect me
  back to the exam if I accidentally navigate away, so that the contract
  is clear but not destructive.
- As a **teacher reviewing violations**, I want every whitelist / binding
  mismatch to land in `IpViolationLog` with `{ userId, examId,
expectedIp, actualIp, violationType, createdAt }`, so that post-hoc
  review is possible — and I want the "Proctoring" sub-tab on
  `/exams/[examId]` to show the live log without a SQL detour.
- As a **platform operator**, I want the "enabled + empty list" case to
  **deny all** (fail-closed), so that a misconfigured exam never
  silently permits everyone.

## Scope

### In scope

- Page lock: `hooks.server.ts` redirects active-session users to
  `/exams/[examId]` for any path outside the exam tree.
- IP whitelist evaluation: CIDR matching via `isIpInCidr`
  (IPv4, native IPv6, v4-mapped IPv6 via Node `net.BlockList`);
  `isIpInWhitelist` returns true iff any CIDR matches.
  Fail-closed when enabled with empty list.
- IP binding: first call stamps `ExamParticipation.ipPin`; subsequent
  calls compare against the pin.
- Violation recording: `logViolation` / `logViolationInTx` insert rows
  into `IpViolationLog`. All rows are tied to an exam (FK `NOT NULL`).
- Violation log UI: `ExamProctoringTab.svelte` is the manager-only
  "Proctoring" sub-tab on the exam detail page; it consumes
  `listExamIpViolations(examId)` results loaded by
  `apps/web/src/routes/(app)/exams/[examId]/+page.server.ts`.
- Violation modes: `block` → `{ allowed: false, violationType }` result
  (caller rejects request); `notify` → log and `{ allowed: true }`.
- `checkProctoringGate` / `checkExamGate` — single entry point from
  route loaders that composes existence, visibility, membership,
  course-archived, time window, and IP checks into one verdict.
- `getPageLockedContext` — hook-layer helper that asks "is this user
  currently inside an active published exam with page lock on?"
- Client-IP trust model: Cloudflare-only (`CF-Connecting-IP`); missing
  header in production returns 403 (documented in `docs/SECURITY.md`).

### Out of scope

- Contest / assignment IP gating. Contests were briefly proctored and
  reverted (see `fa742c7`). Assignments never had proctoring.
- Remote proctoring (webcam, screen recording, browser lockdown).
- Whole-course IP locks (per-exam only).
- Per-problem IP locks (per-exam only).

## Acceptance Criteria

### Page lock (hooks.server.ts)

- GIVEN a user with an `ActiveExamSession` where `endedAt IS NULL` AND
  the parent exam has `pageLockEnabled: true` AND `status:
'published'` AND `now < endsAt`, WHEN they request any path OTHER
  than `/api/`, `/signin`, `/signout`, or `/exams/[examId]/...`,
  THEN `hooks.server.ts` returns `307 /exams/[examId]`.
- BEFORE the redirect, WHEN path is disallowed, THEN a
  `visibility_lost` event is written to `ExamSessionEvent` with
  `metadata: { attemptedPath }`.
- WHEN `recordEvent` fails, THEN the redirect still fires and a warning
  is logged — page-lock is fail-safe.
- WHEN `getActiveExamContext` fails (DB error), THEN hooks fail OPEN:
  log `warn` and allow the request through; users must never be
  locked out of the whole site by a degraded lock subsystem.
- The redirect context is cached 30s per user
  (`examContextCache`, FIFO bounded to 10k entries) so every request
  does not hit the DB; a freshly-released user may see one stale
  redirect before the cache expires.

### IP whitelist

- GIVEN `ipWhitelistEnabled: true` AND the client IP matches any CIDR
  in `ipWhitelist`, THEN `checkIpLock` treats whitelist as PASS.
- GIVEN `ipWhitelistEnabled: true` AND the whitelist is EMPTY,
  THEN NO client IP matches → violation (fail-closed).
- GIVEN `ipWhitelistEnabled: true` AND the client IP matches NO CIDR
  AND `ipViolationMode: 'block'`,
  THEN `checkIpLock` returns `{ allowed: false, violationType:
'whitelist' }`.
- GIVEN the same scenario with `ipViolationMode: 'notify'`,
  THEN an `IpViolationLog` row is inserted and `checkIpLock` returns
  `{ allowed: true }`.
- GIVEN `ipWhitelistEnabled: false`, THEN whitelist is skipped
  regardless of list contents.
- CIDR edge cases:
  - `prefix = 0` matches any IP.
  - `prefix = 32` requires exact match.
  - Malformed CIDR (`/33`, `/-1`, `/129`, missing IP, non-numeric,
    family mismatch between IP and CIDR) → match is false, never thrown.
  - Native IPv6 (`2001:db8::1`) matches native-IPv6 CIDRs
    (`2001:db8::/32`, `::/0`, `::1/128`) via Node `net.BlockList`.

### IP binding

- GIVEN `ipBindingEnabled: true` AND the participation row has
  `ipPin: null`, WHEN `checkIpLock` runs,
  THEN `examParticipationIpRepo.updateIpPin` stamps the current IP and
  returns `{ allowed: true }`.
- GIVEN `ipPin` is set AND the client IP differs,
  WHEN `ipViolationMode: 'block'`, THEN `{ allowed: false,
violationType: 'binding' }`.
- GIVEN `ipPin` is set AND the client IP matches, THEN `{ allowed:
true }`.
- GIVEN `ipBindingEnabled: true` AND `participation === null`,
  WHEN `checkIpLock` runs, THEN binding is skipped (no pin to set or
  compare).

### Violation log shape

- Every `IpViolationLog` row includes:
  - `userId` (FK cascade delete user).
  - `examId` (FK cascade delete exam, NOT NULL — schema enforced).
  - `violationType`: `'whitelist' | 'binding'` (`IpViolationType` enum).
  - `actualIp`: the client IP that triggered.
  - `expectedIp`: comma-separated whitelist entries (for whitelist
    violations) OR the pinned IP (for binding violations).
  - `createdAt`: insertion timestamp.
- Indexes: `@@index([examId, createdAt])`, `@@index([userId, createdAt])`.

### Composite gate (`checkExamGate`)

- GIVEN all of: exam exists, `status: 'published'`, user has active
  course membership, course not archived, `now` in `[startsAt - grace,
endsAt)`, and IP checks pass, THEN `checkExamGate` returns `{ ok:
true }`.
- Specific denial reasons (machine-readable, non-localized strings):
  - `not_found` — exam missing.
  - `not_published` — `status !== 'published'`.
  - `not_enrolled` — no active course membership.
  - `course_archived` — parent course archived.
  - `not_started` — `now < startsAt - grace`.
  - `ended` — `now >= endsAt`.
  - `ip_whitelist` — whitelist violation with block mode.
  - `ip_binding` — binding violation with block mode.
- Contests use `checkContestGate` which has NO membership, archived,
  or IP checks — just existence, `published` visibility, and time
  window.

### Client IP resolution

- Production requires `CF-Connecting-IP` header; absent header →
  `getClientIp(event)` throws 403. No XFF fallback.
- Dev/test accepts `x-dev-ip` override so integration tests can inject
  arbitrary client IPs.
- The IP resolver lives at `apps/web/src/lib/server/shared/client-ip.ts`
  and is called before entering the domain layer; `checkIpLock`
  receives an already-resolved string.

## Edge Cases & Failure Modes

- **Enabled + empty whitelist = deny all.** Previously this silently
  allowed everyone; now hard-denied. Regression-tested in
  `tests/unit/domain/ip-utils.test.ts`.
- **`ipPin` race on concurrent first submissions.** `updateIpPin`
  writes inside the same transaction as the check, so two near-
  simultaneous first requests serialize; whichever commits first wins
  the pin, the other becomes a binding violation.
- **CF-Connecting-IP spoofing.** Mitigated by Cloud Run ingress =
  Internal + Cloud Armor allowlist of Cloudflare CIDR ranges
  (`docs/DEPLOYMENT.md` — Cloudflare + Cloud Armor Setup section). Any
  direct hit bypassing Cloudflare is blocked at the ingress, so the
  header is trustworthy inside the app.
- **Violation mode change mid-exam.** If a teacher flips `block →
notify` while students are taking the exam, ongoing blocked requests
  don't retroactively become notifies — but the very next request
  the student makes hits the new config.
- **Contest routes with IP fields in config.** The contest
  zod schema still carries `ipLockFields` + `pageLockEnabled` as
  residual Phase 3 artefacts (see
  `packages/core/src/schemas/contest.ts`). The DB column, domain
  layer, and gate.ts have all been cleaned up; the schema fields are
  accepted and silently ignored. Flagged as a cleanup TODO in
  `docs/specs/contests.md`.
- **Page-lock cache + instructor release.** When an instructor
  releases a session, the 30s cache on `examContextCache` can still
  redirect the student for up to 30 seconds. A forced cache-bust is
  not currently implemented — the delay is acceptable.

## Implementation References

### Domain

- `packages/domain/src/shared/ip-utils.ts` — `checkIpLock`,
  `isIpInCidr`, `isIpInWhitelist`, `IpLockConfig`, `IpCheckResult`,
  `ipToNumber`.
- `packages/domain/src/shared/page-lock.ts` — `getPageLockedContext`.
- `packages/domain/src/proctoring/gate.ts` — `checkProctoringGate`,
  `checkProctoringGateInTx`, `checkExamGate`, `checkContestGate`,
  `ProctoringDenialReason`.
- `packages/domain/src/proctoring/violation-logger.ts` — `logViolation`,
  `logViolationInTx`.

### Web layer

- `apps/web/src/hooks.server.ts` —
  - `setSecurityHeaders` (nosniff, DENY, referrer-policy,
    permissions-policy, HSTS in prod).
  - `getCachedPageLockContext` / `getCachedActiveExamContext` (30s
    FIFO/LRU caches).
  - Page-lock redirect + `visibility_lost` event.
- `apps/web/src/lib/server/exam-lock.ts` — `getActiveExamContext`,
  `isAllowedPathForExam`.
- `apps/web/src/lib/server/page-lock.ts` — re-export of
  `getPageLockedContext`.
- `apps/web/src/lib/server/shared/client-ip.ts` — `getClientIp`
  (Cloudflare-only trust model, production vs dev branching).
- `apps/web/src/lib/components/course/exam/ExamProctoringTab.svelte` —
  manager-only "Proctoring" sub-tab consumer of the IP violation log
  (wired in `apps/web/src/routes/(app)/exams/[examId]/+page.svelte`).

### Schema

- `packages/db/prisma/schema/contest.prisma` (Exam + related):
  - `Exam.pageLockEnabled`, `.ipWhitelistEnabled`, `.ipBindingEnabled`,
    `.ipWhitelist` (String[]), `.ipViolationMode` (enum).
  - `ExamParticipation.ipPin` — authoritative IP-binding pin consulted
    by `checkIpLock`.
  - `IpViolationLog` model.
  - Enums: `IpViolationMode`, `IpViolationType`,
    `ExamSessionEventType`.
- `packages/core/src/types.ts` — `ipLockFields` (domain-facing array
  variant), `ipLockFormFields` (form textarea variant),
  `ipViolationModeSchema` (enum `'block' | 'notify'`).

### Tests

- `tests/unit/domain/ip-utils.test.ts` — CIDR matching, fail-closed
  whitelist, binding flow.
- `tests/unit/domain/proctoring-gate.test.ts` — composite gate with
  all denial reasons, including contest vs exam split.
- `tests/unit/domain/exam-session.test.ts` — session start/end plumbing.

## Open Questions / TODO

- **Whitelist UI for bulk import.** Teachers currently paste CIDR
  entries one per line into a textarea (`ipLockFormFields
.ipWhitelistText`). A CSV import / lab-network import flow is a
  common ask but out of scope here.
- **IpViolationLog retention.** No current pruning policy; rows
  accumulate forever. Not critical at current scale; revisit when
  row count crosses 10M.
