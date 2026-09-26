# Data, cache and workflows decisions

Durable decisions for the PostgreSQL schema and repositories, Redis usage, and Temporal orchestration. Read the relevant entries before planning a change here; a change that contradicts an entry must say so and update or replace the entry in the same PR. Current mechanics live in [Database Schema](../architecture/DATABASE.md), [Redis Architecture](../architecture/REDIS.md) and [Architecture Overview](../architecture/ARCHITECTURE.md).

### DAT-01 Data access goes through `@nojv/db` repositories

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md), [2026-04-02-architecture-implementation-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-architecture-implementation-plan.md)

Domain code reads and writes through per-domain repository objects in `@nojv/db`; transactions use `runTransaction` / `TransactionClient`, and repositories accept a transaction client. This keeps Prisma details out of business logic.

- Rule: web reaches the database only through `@nojv/application`; the import direction and its named exceptions are ENG-02 in engineering.md.
- Rule: the raw client (`prismaAdapterClient`) is an escape hatch for better-auth and narrow transactional code, not a general access path.
- Code: `packages/db/src/index.ts`, `packages/db/src/transaction.ts`, `packages/db/src/repositories/`

### DAT-02 Entities are identified by cuid only; no slugs

**Decided:** 2026-04 · **Source:** [2026-04-11-course-experience-redesign-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-course-experience-redesign-design.md), [2026-04-14-course-experience-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-14-course-experience-redesign.md), [2026-04-16-cuid-url-unification-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-16-cuid-url-unification-design.md), [2026-04-11-silent-failure-and-problemids-fix](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-11-silent-failure-and-problemids-fix.md)

Course, Assessment, Exam, Contest and Problem use their cuid `id` as the only identifier in URLs and APIs; slug columns and lookups were dropped. Dual identifiers caused silent 404s and collisions, and a slug regex rejected real ids and blocked assignment creation.

- Rejected: a slug-redirect table (pages are auth-gated, no external bookmarks); `@@unique([courseId, title])` (duplicate titles are the teacher's concern).
- Rule: do not reintroduce slug columns or slug lookups; validate id inputs as non-empty strings only, never with a format regex.
- Rule: seed rows may use readable literal ids (`problem_warmup-sum`); code must not depend on their shape.
- Code: `packages/db/prisma/schema/course.prisma`, `packages/db/prisma/schema/contest.prisma`

### DAT-03 Submission stays one flat table with per-context FKs and a CHECK

**Decided:** 2026-06 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md), [2026-06-11-triplet-model-convergence-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-triplet-model-convergence-design.md), [2026-06-11-timed-assessment-supertype-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-timed-assessment-supertype-design.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

`Submission` keeps separate nullable FKs (`assessmentId`+`courseId`, `examId`, `contestId`, `participationId` for virtual) and the raw-SQL `Submission_canonical_context_chk` allows at most one context per row (none = practice). Real FKs keep DB-level referential integrity and delete semantics (activity FKs `Restrict`, participation `Cascade`).

- Rejected: per-context extension tables; a polymorphic `(contextType, contextId)` FK (loses cascade/restrict, ~90-file blast radius, the 2026-06-12 audit said not to reopen it); `contestParticipationId` (dropped — contest and exam submissions resolve by `(contestId|examId, userId)`).
- Rule: a new submission context must be added to the CHECK constraint in a migration.
- Rule: scoring loads submissions by `(contestId|examId, userId)`, not through a participation id.
- Code: `packages/db/prisma/schema/submission.prisma`, `packages/db/prisma/migrations/20260716000016_submission_context_constraints/migration.sql`

### DAT-04 One `Participation` table for contest, exam and virtual

**Decided:** 2026-06 · **Source:** [2026-06-11-timed-assessment-supertype-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-timed-assessment-supertype-design.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

`ContestParticipation`, `ExamParticipation` and `VirtualContest` merged into `Participation` with a `type` discriminator, real nullable `contestId`/`examId` FKs, real nullable type-specific columns (`ipPin`, `ipGateExemptUntil`, virtual `startedAt`/`endsAt`) and a single `updateWithVersion` conflict path. Three near-identical tables carried three copies of version logic.

- Rejected: a polymorphic `contextId` string (no FK integrity); `typeData Json` (IP-gate fields are read on every request); partial unique indexes plus find-or-create (full `@@unique([type, contestId, userId])` works because NULLs are distinct and serves as an upsert target).
- Rule: Participation CHECKs (`single_context`, `virtual_window`, `ip_exam_only`) live in raw-SQL migrations and must be replayed into the test DB via `tests/setup/replay-constraints.ts`.
- Rule: large schema reshapes go expand → dual-write/backfill → reconcile → switch reads → contract, each stage revertible until contract.
- Code: `packages/db/prisma/schema/contest.prisma`, `tests/setup/replay-constraints.ts`

### DAT-05 Activity config stays inline per activity table

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md)

Activity settings (allowed languages, scoreboard mode, exam IP/page lock) are columns on `Contest`, `Exam` and `Assessment` rather than a normalized `EventConfig` table; duplication stays at the column level and enforcement logic is shared.

- Rejected: a separate `EventConfig` table.
- Rule: keep one shared IP-lock enforcement implementation.
- Code: `packages/application/src/shared/ip.ts`, `packages/db/prisma/schema/contest.prisma`

### DAT-06 File bodies live in object storage, never in Postgres

**Decided:** 2026-05 · **Source:** [2026-05-28-judge-isolation-domjudge-validator](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-28-judge-isolation-domjudge-validator.md), [2026-05-28-storage-unification-and-uploads](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-28-storage-unification-and-uploads.md)

Submission sources (one object per file), full verdict detail, checker/interactor scripts, testcases and workspace files live in `@nojv/storage`; the DB keeps versioned JSON pointers (`sourceStorage`, `verdictDetailStorage`, `checkerStorage`, `interactorStorage`) plus a small `verdictSummary` for lists. Multi-file sources stored as one JSON string broke plagiarism detection.

- Rejected: script bodies inside `judgeConfig` JSON; a single `validatorKey` for checker and interactor.
- Rule: no file bodies in Postgres columns; plagiarism reads per-file sources from storage.
- Rule: a storage read failure at judge time fails closed.
- Code: `packages/storage/src/keys.ts`, `packages/db/prisma/schema/submission.prisma`, `packages/db/prisma/schema/problem.prisma`

### DAT-07 Users with graded history are anonymized, not deleted

**Decided:** 2026-07 · **Source:** [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

`User.disabled` is the only account-disabled flag (the duplicate `UserStatus.disabled` enum value was dropped). A user whose deletion would cascade graded exam/contest submissions is anonymized and disabled instead of hard-deleted.

- Rule: deletion blockers must include submission and participation history.
- Code: `packages/application/src/user/mutations.ts`

### DAT-08 Grading audit history survives membership merges

**Decided:** 2026-09 · **Source:** [2026-09-07-course-roster](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-07-course-roster.md)

Grading audit logs carry nullable `courseMembershipId`/`sourceMembershipId` without FKs and keep historical user snapshots; a roster merge transfers current ownership but preserves origin ids, content, actor and timestamps, appending a `merge` event per conflicting record.

- Rule: never rewrite historical audit events; append instead.
- Code: `packages/db/prisma/schema/submission.prisma`

### DAT-09 Redis keys and channels live in one registry

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md), [2026-04-02-temporal-migration-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-temporal-migration-design.md), [2026-05-18-feature-completion-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-18-feature-completion-batch.md), [2026-05-20-grading-feedback-audit-batch](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-05-20-grading-feedback-audit-batch.md)

Every Redis key and pub/sub channel is declared in `packages/redis/src/keys.ts` with the `nojv:` prefix so publishers and subscribers cannot drift. Caches call `getRedis()` directly with a registry key and are best-effort: a Redis failure falls through to live computation.

- Rejected: generic `cache.ts`/`cooldown.ts` helper modules (zero callers, deleted 2026-05); an earlier typed `cacheGet<T>(key, schema)` went with them.
- Rule: never build ad-hoc key strings.
- Rule: if a generic JSON cache is reintroduced, validate reads with a Zod schema.
- Code: `packages/redis/src/keys.ts`, `packages/application/src/admin/index.ts`

### DAT-10 Redis holds only state rebuildable from Postgres

**Decided:** 2026-04 · **Source:** [2026-04-02-temporal-migration-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-temporal-migration-design.md)

Redis is for pub/sub fan-out, cross-instance rate limits, locks and caches; PostgreSQL is the source of truth.

- Rejected: a Redis `SET NX` submit-cooldown key (cooldown is enforced from the database); a Redis sorted-set scoreboard (see DAT-11).
- Rule: never store in Redis anything that cannot be rebuilt from PostgreSQL.
- Code: `packages/application/src/shared/submit-cooldown.ts`, `packages/application/src/submission/creation.ts`

### DAT-11 Scoreboards are built from Postgres; Redis only nudges

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-09-24-codebase-clarity](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-24-codebase-clarity.md)

`getScoreboard`/`computeScoreboard` (`contest/scoring.ts`) always compute from Postgres; freeze uses `Contest.frozenBoard`/`frozenAt`. Redis holds a short cache, a rebuild lease and a `scoreboard:update` nudge throttled to one per 10 s per contest; clients use SSE through a process-wide shared subscriber with a polling fallback. Cache leases use unique tokens released by atomic compare-and-delete.

- Rejected: a Redis ZSET scoreboard with RENAME freeze (write-only dead code, removed 2026-06); a per-submission 1 Hz Temporal-query stream (competed with judging for worker slots); unthrottled per-judge publishes.
- Rule: do not add per-client Redis connections or Temporal polling for live updates.
- Rule: materialized score caches wait until measured latency needs them.
- Code: `packages/application/src/contest/scoring.ts`, `packages/redis/src/keys.ts`, `apps/web/src/lib/server/shared/sse-slot.ts`

### DAT-12 Redis-backed rate limits fail closed fast

**Decided:** 2026-06 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md), [2026-07-24-auth-rate-limit-admin-mode](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-24-auth-rate-limit-admin-mode.md)

Rate limiters use a dedicated ioredis connection with `enableOfflineQueue: false` and `maxRetriesPerRequest: 1`, so an unreachable Redis fails closed fast with 503 (`apiRateLimiter` alone falls back to an in-process limiter) instead of a ~10 s hang. The first protected request awaits one shared lazy connection before consuming quota. ioredis queues rather than throws, so the documented fail-closed behavior previously never happened.

- Rule: Redis-backed limits and security proofs fail closed; never fail open on privileged paths.
- Code: `packages/redis/src/connection.ts`, `apps/web/src/lib/server/shared/rate-limiter.ts`

### DAT-13 Temporal runs all async orchestration

**Decided:** 2026-04 · **Source:** [2026-04-02-temporal-migration-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-temporal-migration-design.md)

Temporal (TypeScript SDK) runs judging, rejudge, lifecycle, reminders and plagiarism, giving durable timers and shared Zod types; operators use the Temporal UI. Separate task queues (`judge` for sandbox work, `judge-state`, `platform` for DB/network-only work) let worker pools deploy and scale independently. Temporal uses its own `temporal` and `temporal_visibility` databases.

- Rejected: BullMQ and its custom queue-admin page (removed).
- Rule: judge workflow ids are `judge-${submissionId}` with `REJECT_DUPLICATE`.
- Rule: sandbox-running activities go on the judge queue; lifecycle and plagiarism go on the platform queue.
- Code: `packages/temporal/src/task-queues.ts`, `packages/temporal/src/dispatch.ts`, `apps/worker/src/workflows/`

### DAT-14 Temporal stays behind an orchestration port

**Decided:** 2026-04 · **Source:** [2026-04-02-microservice-architecture-redesign](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-microservice-architecture-redesign.md), [2026-04-02-architecture-implementation-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-02-architecture-implementation-plan.md)

Product code dispatches through the `DomainOrchestrationAdapter` port (`dispatchRejudge`, `cancelRejudge`, ...) and never sees Temporal internals. `@nojv/temporal` is a client/dispatch-only package depending on `@nojv/core`; web and worker wire that port to it; workflows and activities live in `apps/worker`.

- Rejected: the original `@nojv/job-dispatch` package (removed).
- Rule: `@nojv/application` must not import `@temporalio/*` or `@nojv/temporal`.
- Rule: web imports `@nojv/temporal` only in `src/lib/server/domain-orchestration.ts`.
- Code: `packages/application/src/shared/orchestration.ts`, `apps/web/src/lib/server/domain-orchestration.ts`

### DAT-15 Workflow code changes are versioned with `patched()`

**Decided:** 2026-06 · **Source:** [2026-06-12-full-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-12-full-audit-remediation.md)

Any behavioral change to workflow code is guarded with `patched()`/`deprecatePatch()` or deployed only when no long-lived workflows are in flight, because contest-lifecycle and exam-auto-close histories otherwise fail replay with non-determinism errors. Lifecycle changes re-dispatch with `TERMINATE_EXISTING`.

- Rule: never silently reorder or add activity calls in an existing workflow.
- Rule: workflow and query names are a cross-package contract covered by the workflow-registration test.
- Code: `apps/worker/src/workflows/`, `packages/temporal/src/dispatch.ts`

### DAT-16 Workflow inputs carry ids, not blobs

**Decided:** 2026-07 · **Source:** [2026-07-07-system-health-check-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-07-07-system-health-check-remediation.md)

Source and testcase bytes never travel through Temporal payloads; `durableJudgeWorkflow` carries only an execution id and reads an immutable checksummed object. Payloads are capped around 1-2 MB while authoring allowed 16 MB blobs, so large problems failed silently.

- Rule: never put source or testcase bytes into workflow inputs or activity results.
- Code: `apps/worker/src/workflows/durable-judge.ts`

### DAT-17 Batch rejudge isolates child failures and keeps cancellation

**Decided:** 2026-06 · **Source:** [2026-06-10-audit-remediation](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-10-audit-remediation.md), [2026-06-11-post-audit-next-phase](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-06-11-post-audit-next-phase.md)

Each child in a batch rejudge has its own error handling so one failure does not kill the parent or siblings.

- Rejected: `parentClosePolicy=ABANDON` (breaks the cancellation propagation `cancelRejudge` relies on).
- Rule: do not set ABANDON on rejudge child workflows.
- Code: `apps/worker/src/workflows/rejudge.ts`

### DAT-18 Reminders are lead-day checkpoints with dedupe keys

**Decided:** 2026-07 · **Source:** [2026-04-19-notification-center-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-notification-center-design.md), [2026-04-19-notification-center-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-04-19-notification-center-plan.md), [2026-07-10-email-notifications-design](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-email-notifications-design.md), [2026-07-10-email-notifications-plan](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/completed/2026-07-10-email-notifications-plan.md)

Lifecycle workflows wake at `target − N days` for N = 7…1 and, at each checkpoint, read current preferences and notify only users whose effective lead days equal N, so preference changes need no rescheduling. Assignment workflows first send `assignment_started` at `opensAt`; due-soon skips students with full marks; fan-outs insert in batches.

- Rejected: a fixed 24 h or 15-minute reminder; backfilling past checkpoints; accepting duplicates after restarts (2026-04, replaced by unique `Notification.dedupeKey`).
- Rule: skip checkpoints before `opensAt`/publish or already past; never backfill.
- Rule: reminder and answer notifications carry a `dedupeKey` so replays and `TERMINATE_EXISTING` re-dispatch stay idempotent.
- Rule: a new notification type needs the enum, the email type list and i18n messages.
- Code: `apps/worker/src/workflows/reminder-checkpoints.ts`, `apps/worker/src/workflows/assignment-due-soon.ts`, `packages/application/src/notification/index.ts`

### DAT-19 Cron processors are a cron parent awaiting a continue-as-new child

**Decided:** 2026-09 · **Source:** [2026-09-22-durable-work-cron](https://github.com/NOJV-TW/NOJV/blob/f0347eb12ab7eb0b2269dcf774aff442f837bb85/docs/plans/active/2026-09-22-durable-work-cron.md)

The durable-work and lifecycle-reconciler singletons are small cron parents that await a draining child which continues-as-new at its batch bound, because Continue-As-New does not carry a cron schedule and recurrence stopped after a continued run ended.

- Rejected: a cron workflow that itself continues-as-new.
- Rule: preserve activity limits, fairness cursors, leases and DB idempotency in processors.
- Rule: switch workflow types only after the old singleton is terminal; never terminate its in-flight activity.
- Code: `apps/worker/src/workflows/durable-work.ts`, `apps/worker/src/workflows/lifecycle-reconciler.ts`
