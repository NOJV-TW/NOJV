# Redis Architecture

Redis 8 serves as the real-time data layer. It does not store durable state — PostgreSQL is the source of truth. Redis handles pub/sub and rate limiting.

## Key Naming Convention

Keyed state uses the prefix `nojv:{domain}:{identifier}` (applies to keyed state, not pub/sub channels — see `packages/redis/src/keys.ts:1-3`).

| Pattern                      | Type                  | TTL    | Purpose                            |
| ---------------------------- | --------------------- | ------ | ---------------------------------- |
| `nojv:cache:admin-dashboard` | String (JSON)         | 300 s  | Admin dashboard read-through cache |
| `rl:*` (no `nojv:` prefix)   | rate-limiter-flexible | varies | API / form / sign-in rate limiting |

## Pub/Sub

Channels are unprefixed (no `nojv:`). They're consumed by the SSE endpoint at `/api/events/stream`, which keeps the connection open for up to 10 minutes with 30-second keepalive pings.

| Channel                                   | Producer                      | Purpose                                |
| ----------------------------------------- | ----------------------------- | -------------------------------------- |
| `user:{userId}`                           | `publishVerdict`              | Submission verdict toasts to the owner |
| `notification:{userId}`                   | `publishNotification` / batch | Durable notification fan-out           |
| `contest:{contestId}`                     | `publishContestEvent`         | Contest lifecycle events               |
| `assessment:{assessmentId}`               | `publishAssessmentDeadline`   | Assessment deadline reminders          |
| `clarification:{contextType}:{contextId}` | `publishClarification`        | Clarification thread updates           |

**Event Types** (string constants in `packages/core/src/queue.ts:5-10`, discriminator field `type`):

| Event                 | Payload                                                             | When                                                                  |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `submission:verdict`  | `{ type, submissionId, verdict, score, problemId }`                 | Submission judging completes                                          |
| `contest:starting`    | `{ type }`                                                          | Contest becomes active                                                |
| `contest:ending`      | `{ type }`                                                          | Contest ends                                                          |
| `assignment:deadline` | `{ type }` (assessmentId carried in the channel name)               | Assessment deadline approaching                                       |
| `notification`        | `{ type, id?, notificationType, params, linkUrl, createdAt? }`      | New durable notification (id/createdAt omitted on batch-signal pings) |
| `clarification`       | `{ type, action, payload }` (action: created / updated / dismissed) | Clarification thread mutation                                         |

Events are published by Temporal activities and by domain mutations that emit notifications/clarifications. The full Zod schema lives in `packages/core/src/queue.ts` (`sseEventSchema`).

## Scoreboard

Contest leaderboards are not stored in Redis. They are computed on read directly from PostgreSQL (`getScoreboard` in `packages/domain/src/contest/scoring.ts` reads `contest.participations` + submissions and calls `buildScoreboard`), including ICPC/IOI ranking and freeze (gated by the `Contest.frozenBoard` / `Contest.frozenAt` columns, which cut off submissions after the freeze point). See [Judge Pipeline](./JUDGE_PIPELINE.md) and [Architecture Overview](./ARCHITECTURE.md).

## Submit Cooldown

Cooldown enforcement lives in the database — see `checkExamSubmitCooldown` in `packages/domain/src/exam/mutations.ts`, which reads the user's most recent submission via `submissionRepo.findMostRecent`.

## Rate Limiting

`rate-limiter-flexible` with a Redis backend (`apps/web/src/lib/server/shared/rate-limiter.ts`):

- Keyed on the Cloudflare-aware client IP via `getClientIp(event)`, not on userId.
- Key prefix is `rl` — no `nojv:` prefix.
- Four shared limiters, not per-endpoint:
  - `apiRateLimiter` — 60 req / 60 s
  - `writeApiRateLimiter` — 10 req / 60 s
  - `formActionRateLimiter` — 20 req / 60 s (consumed via `withRateLimit` → `consumeFormRateLimitInternal`)
  - `signInRateLimiter` — 5 attempts / 15 min (password sign-in)
- Dev / test multiply points by 1000× to avoid E2E flakiness.
- In production, if Redis is unreachable at limiter construction time, the limiter fails closed (rejects every request) rather than falling back to per-instance memory.

## Observability

The `@nojv/redis` package no longer registers any OpenTelemetry metrics of its own.

## Connection Management

Both `apps/web` and Temporal activities use singleton Redis connections from `@nojv/redis`:

- **Web**: imports `getRedis` (and `createSubscriber`, `keys`) directly from `@nojv/redis`. There is no `$lib/server/redis.ts` shim.
- **Worker / Temporal activities**: live in `apps/worker/src/activities/` (`judge-bundle.ts` / `platform-bundle.ts`) and import `getRedis` / `pubsub` from `@nojv/redis` directly.
- **Subscriber**: a separate connection (`createSubscriber`) is created for pub/sub to avoid blocking the main connection.

## Related Docs

- [Architecture Overview](./ARCHITECTURE.md)
- [Deployment Guide](../operations/DEPLOYMENT.md)
