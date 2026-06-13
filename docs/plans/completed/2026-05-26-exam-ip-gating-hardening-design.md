# Exam IP Gating Hardening — Design

Date: 2026-05-26
Branch: `audit/full-functional-2026-05-26`

## Problem

The exam IP whitelist / IP binding feature is enforced **only at exam page
navigation** (`exams/[examId]/+layout.server.ts` → `checkProctoringGate`).
SvelteKit `/api/*` routes are an independent route tree and never trigger that
layout, so during an exam a student can:

- submit code (`POST /api/submissions`) from a non-whitelisted / unpinned IP,
- poll verdicts (`GET /api/submissions/[id]`, `/source`, `/stream`),
- receive live judge events (`GET /api/events/stream`),
- ask clarifications (`POST /api/clarifications`)

…all without any IP re-check, because `createQueuedSubmissionRecord` explicitly
`void clientIp` ("Exams own all IP gating") and the hooks-layer exam lock only
does **navigation containment**, not IP.

Secondary findings:

- `block` violation mode **never writes `IpViolationLog`** (only `notify` does)
  → a teacher using block mode gets zero audit trail.
- `checkExamIpAccess` (`exam/queries.ts`) is dead code (defined, never called).
- The layout comment claims "hooks-based exam lock is the primary IP enforcement
  path" — currently false; hooks does not check IP.
- `isProctoredEntityAllowed` (hooks page-lock) uses `pathname.includes(...)`
  instead of a strict prefix match.
- No teacher control to re-record a student's pinned IP (computer swap).

`getClientIp` trust model is sound (production: Cloudflare `CF-Connecting-IP`
only, fail-closed 403 if absent; not XFF-spoofable) — IP spoofing is **not** a
viable bypass and is out of scope.

## Decisions (confirmed with user)

1. **Enforcement: centralize in hooks.** When a student has an active exam
   session, `hooks.server.ts` runs the IP gate on **every** request (pages +
   all `/api`), reusing the existing `checkProctoringGate`. One chokepoint;
   future endpoints are covered automatically.
2. **Teacher control: per-student "reset IP binding".** Clears that student's
   `ipPin` and grants a short grace exemption so they can move to a new machine
   without tripping the gate; the new machine re-pins on first access. No
   whole-exam kill switch.
3. **Also: tighten path match + fail-closed IP.** `isProctoredEntityAllowed`
   → strict prefix; the new hooks IP gate fails **closed** on error when we know
   the student is mid-exam (navigation containment keeps its existing fail-open
   for availability).

## Design

### Data model

Add to `ExamParticipation`:

```prisma
ipGateExemptUntil DateTime?   // teacher-granted grace window; gate is skipped while now < this
```

Migration: `ALTER TABLE "ExamParticipation" ADD COLUMN "ipGateExemptUntil" TIMESTAMP(3);`

### Pure decision function

`packages/application/src/shared/ip.ts` — extract the decision into a pure, sync,
heavily-testable function:

```ts
evaluateIpLock(config, clientIp, ipPin, opts?: { exemptUntil?: Date|null; now?: Date })
  -> { allowed: boolean; violationType?: "whitelist" | "binding"; shouldPin: boolean }
```

- `exemptUntil > now` → `{ allowed: true, shouldPin: bindingEnabled && !ipPin }`
  (still pins on first contact so the new machine is bound when grace ends; never blocks/logs).
- whitelist enabled && !inWhitelist → `violationType:"whitelist"`, `allowed = mode !== "block"`.
- binding enabled && ipPin && ipPin !== clientIp → `violationType:"binding"`, `allowed = mode !== "block"`.
- `shouldPin = bindingEnabled && !ipPin`.

`checkIpLock` is reworked to call `evaluateIpLock`, then perform side effects
(pin via repo, **throttled** violation log) — and now logs in **both** modes
(fixes the block-mode audit gap).

### Throttled violation logging

`block` + per-request enforcement would let one bad-IP student spam
`IpViolationLog` (and the 2000-row cap would then bury other students). Add a
DB-based throttle in `ipViolationLogRepo`: before inserting, look at the most
recent row for `(examId, userId, violationType)`; skip if within
`IP_VIOLATION_LOG_THROTTLE_SECONDS` (60s). Applies to both the in-tx and
non-tx paths.

### Proctoring gate

`checkExamGate` (`proctoring/gate.ts`): read `ipPin` **and**
`ipGateExemptUntil`, call `evaluateIpLock`, pin if `shouldPin`, throttle-log on
violation, return `ip_whitelist` / `ip_binding` when `!allowed`. Behaviour
unchanged except: respects exemption, logs in block mode.

### Hooks enforcement (the core fix)

`hooks.server.ts`, inside the existing active-exam-session block (after
`examCtx` is loaded):

```ts
if (examCtx) {
  const ip = getClientIp(event); // prod: 403 if no CF header (fail-closed)
  let verdict;
  try {
    verdict = await checkProctoringGate({
      entityKind: "exam",
      entityId: examCtx.exam.id,
      userId,
      ip,
    });
  } catch (err) {
    // We KNOW the student is mid-exam and the IP gate errored → fail closed.
    examLockLogger.error("exam IP gate failed — failing closed", { userId, err });
    return cleanPath.startsWith("/api/")
      ? json({ error: "..." }, { status: 503 })
      : error(503, m.examShell_ipUnavailable());
  }
  if (!verdict.ok && (verdict.reason === "ip_whitelist" || verdict.reason === "ip_binding")) {
    return cleanPath.startsWith("/api/")
      ? json({ error: m.examShell_ipBlocked(), reason: verdict.reason }, { status: 403 })
      : error(403, m.examShell_ipBlocked());
  }
  // …existing navigation containment (isAllowedPathForExam) …
}
```

Only `ip_*` reasons are acted on here (window/membership remain the layout's /
submission mutation's job). `getActiveExamContext`'s outer try/catch keeps its
fail-open for availability (we can't tell if a student is mid-exam when the DB
is unreachable); the inner IP gate fails closed once we know they are.

The layout `checkProctoringGate` stays for pre-session overview (whitelist
applies before a session starts) and as defence-in-depth; its misleading
comment is updated to state that hooks is now the primary during-exam path.

### Teacher control: reset IP binding

- `examParticipationIpRepo.clearPinAndExempt(examId, userId, exemptUntil)`.
- `exam/session.ts` (or proctoring mutations): `resetStudentIpBinding(actor, { examId, targetUserId })`
  — authorize as course manager/owner or admin (mirror `releaseSessionAsInstructor`),
  set `ipPin = null`, `ipGateExemptUntil = now + RESET_GRACE_MINUTES` (10).
- Web action `resetStudentIpBinding` in `exams/[examId]/+page.server.ts`
  (mirrors the in-flight `releaseStudentSession` action).
- `ExamProctoringTab.svelte`: per active-session row, a "重設 IP 綁定" button;
  show grace status when `ipGateExemptUntil` is in the future.
- i18n: en + zh-TW keys (`examProctoring_resetIpBinding`, confirmation, grace badge).

### Cleanups

- Delete dead `checkExamIpAccess` (`exam/queries.ts`).
- `isProctoredEntityAllowed`: `.includes()` → `=== prefix || startsWith(prefix + "/")`.

## Out of scope

- Whole-exam IP kill switch (rejected — one student's issue shouldn't drop all).
- hooks navigation-lock fail-open redesign, visibility_lost escalation, cache TTL
  tuning (reported, not changed this round).
- IP spoofing defences (already handled by the Cloudflare trust model).

## Tests

- `evaluateIpLock` pure unit tests: whitelist on/off/empty(fail-closed), binding
  pin/match/mismatch, block vs notify, exemption (allowed + still pins),
  `shouldPin`.
- `proctoring-gate`: exemption case; block mode now logs.
- throttle: second identical violation within window is skipped.
- `resetStudentIpBinding`: clears pin + sets grace; rejects non-manager.
- Integration (if the harness supports hooks-level): `/api/submissions` from a
  non-whitelisted IP during an active exam → 403.

```

```
