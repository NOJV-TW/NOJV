# Feature: Proctoring (Exam-Only)

Acceptance spec for the proctoring controls that gate exam access and
logging. Proctoring is a composite of four mechanisms:

1. **Page lock** — when enabled, an active exam session confines the user to `/exams/[examId]` and redirects off-path requests back to that exam.
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
- As a **student**, I want the exam's page-lock setting to determine
  whether other NOJV pages and features remain available during my
  active session.
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
  `/exams/[examId]` for any path outside the exam tree only when
  `pageLockEnabled` is true. When false, ordinary page and API access is
  governed by its normal authorization rules; the exam session remains
  active.
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
- `checkProctoringGate` / `checkProctoringGateInTx` — the public entry
  point from route loaders that composes existence, visibility,
  membership, course-archived, time window, and IP checks into one
  verdict. Internally it dispatches to the non-exported `checkExamGate`
  / `checkContestGate` helpers by entity kind.
- Exam-specific routes and exam submissions continue to check exam
  membership, time window, and IP policy independently of page lock.
- The page-lock setting does not detect browser tab or window switching,
  fullscreen changes, or navigation outside NOJV.
- Client-IP trust model: Cloudflare-only (`CF-Connecting-IP`); missing
  header in production returns 403 (documented in `docs/operations/SECURITY.md`).

### Out of scope

- Contest / assignment IP gating. Contests were briefly proctored and
  reverted (see `fa742c7`). Assignments never had proctoring.
- Remote proctoring (webcam, screen recording, browser lockdown).
- Whole-course IP locks (per-exam only).
- Per-problem IP locks (per-exam only).

## Acceptance Criteria

### Page lock (hooks.server.ts)

- GIVEN an active session and `pageLockEnabled: true`, WHEN the user
  requests a page outside that exam, THEN `hooks.server.ts` returns
  `307 /exams/[examId]` and records the attempted path as
  `visibility_lost`.
- GIVEN the same session and `pageLockEnabled: false`, WHEN the user
  requests another authorized NOJV page or ordinary API, THEN the
  request proceeds and the session remains active.
- GIVEN a student whose IP violates the exam policy, WHEN they access an
  exam page or submit to that exam, THEN the request is denied even when
  page lock is disabled; unrelated site access remains available.
- WHEN `recordEvent` fails, THEN the redirect still fires and a warning
  is logged — page-lock is fail-safe.
- The active session and current page-lock setting are read from the
  database on each authenticated request so a setting change applies to
  the student's next request.

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
  `tests/unit/application/ip-utils.test.ts`.
- **`ipPin` race on concurrent first submissions.** `updateIpPin`
  writes inside the same transaction as the check, so two near-
  simultaneous first requests serialize; whichever commits first wins
  the pin, the other becomes a binding violation.
- **CF-Connecting-IP spoofing.** Mitigated by restricting the web origin
  (GKE Ingress / LB) to Cloudflare via the Cloud Armor allowlist of
  Cloudflare CIDR ranges
  (`docs/operations/DEPLOYMENT.md` — Cloudflare + Cloud Armor Setup section). Any
  direct hit bypassing Cloudflare is blocked at the origin, so the
  header is trustworthy inside the app.
- **Violation mode change mid-exam.** If a teacher flips `block →
notify` while students are taking the exam, ongoing blocked requests
  don't retroactively become notifies — but the very next request
  the student makes hits the new config.
- **Page-lock changes during an exam.** Active session and page-lock
  state are read on each authenticated request, so instructor changes
  apply on the student's next request.

## Implementation References

### Domain

- `packages/application/src/shared/ip-utils.ts` — `checkIpLock`,
  `isIpInCidr`, `isIpInWhitelist`, `IpLockConfig`, `IpCheckResult`,
  `ipToNumber`.
- `packages/application/src/proctoring/gate.ts` — `checkProctoringGate`,
  `checkProctoringGateInTx` (the exported entry points);
  `checkExamGate` / `checkContestGate` are internal (non-exported)
  per-kind helpers. `ProctoringDenialReason`.
- `packages/application/src/proctoring/violation-logger.ts` — `logViolation`,
  `logViolationInTx`.

### Web layer

- `apps/web/src/hooks.server.ts` — page-lock redirect, exam-route IP
  checks, and `visibility_lost` event recording.
- `apps/web/src/lib/server/exam-lock.ts` — `getActiveExamContext`,
  `isAllowedPathForExam`.
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
  `parseIpWhitelistText` (newline / CSV / semicolon / whitespace bulk
  import parser), `ipViolationModeSchema` (enum `'block' | 'notify'`).
- `apps/web/src/lib/components/features/course/exam/IpWhitelistField.svelte`
  — shared textarea + CSV/TXT import field used by exam create and
  settings forms.

### Tests

- `tests/unit/application/ip-utils.test.ts` — CIDR matching, fail-closed
  whitelist, binding flow.
- `tests/unit/application/proctoring-gate.test.ts` — composite gate with
  all denial reasons, including contest vs exam split.
- `tests/unit/application/exam-session.test.ts` — session start/end plumbing.
- `tests/unit/core/schemas.test.ts` — whitelist text bulk parser,
  including line-separated, CSV, semicolon, spreadsheet whitespace, and
  duplicate entries.
