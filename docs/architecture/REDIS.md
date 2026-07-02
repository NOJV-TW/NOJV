# Redis Architecture

Redis 8 serves as the real-time data layer. It does not store durable state — PostgreSQL is the source of truth. Redis handles pub/sub and rate limiting.

## Key Naming Convention

Both keyed state and pub/sub channels use the prefix `nojv:{domain}:{identifier}` — see `packages/redis/src/keys.ts`. The only unprefixed keys are the `rl:*` rate-limiter keys.

| Pattern                      | Type                  | TTL    | Purpose                                     |
| ---------------------------- | --------------------- | ------ | ------------------------------------------- |
| `nojv:cache:admin-dashboard` | String (JSON)         | 300 s  | Admin dashboard read-through cache          |
| `nojv:sb-throttle:{id}`      | String                | 10 s   | Scoreboard SSE-nudge throttle (per contest) |
| `rl:*` (no `nojv:` prefix)   | rate-limiter-flexible | varies | API / form / sign-in rate limiting          |

## Pub/Sub

Channels are `nojv:`-prefixed like keyed state. The general SSE endpoint `/api/events/stream` subscribes to the per-user and (authorized) clarification channels and keeps the connection open for up to 10 minutes with 30-second keepalive pings; the contest channel is consumed separately by the scoreboard SSE stream at `/contests/{id}/scoreboard/stream`.

| Channel                                        | Producer                                          | Consumer             | Purpose                                |
| ---------------------------------------------- | ------------------------------------------------- | -------------------- | -------------------------------------- |
| `nojv:user:{userId}`                           | `publishVerdict`                                  | `/api/events/stream` | Submission verdict toasts to the owner |
| `nojv:notification:{userId}`                   | `publishNotification` / batch                     | `/api/events/stream` | Durable notification fan-out           |
| `nojv:contest:{contestId}`                     | `publishContestEvent` / `publishScoreboardUpdate` | `/scoreboard/stream` | Contest lifecycle + scoreboard nudges  |
| `nojv:clarification:{contextType}:{contextId}` | `publishClarification`                            | `/api/events/stream` | Public clarification updates only      |

**Event Types** (string constants in `packages/core/src/sse-events.ts`, discriminator field `type`):

| Event                | Payload                                                        | When                                                                                                              |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `submission:verdict` | `{ type, submissionId, verdict, score, problemId }`            | Submission judging completes                                                                                      |
| `scoreboard:update`  | `{ type }`                                                     | Contest judge completes (10 s-throttled nudge for the scoreboard SSE)                                             |
| `contest:starting`   | `{ type }`                                                     | Contest becomes active                                                                                            |
| `contest:ending`     | `{ type }`                                                     | Contest ends                                                                                                      |
| `notification`       | `{ type, id?, notificationType, params, linkUrl, createdAt? }` | New durable notification (id/createdAt omitted on batch-signal pings)                                             |
| `clarification`      | `{ type, action, payload }` (action: updated / deleted)        | Staff publishes a **public** answer (updated) or a public row is deleted (deleted) — see clarification note below |

Events are published by Temporal activities and by domain mutations that emit notifications/clarifications. The full Zod schema lives in `packages/core/src/sse-events.ts` (`sseEventSchema`).

The clarification channel carries **public content only** — a deliberate anti-leak measure for live exams/contests. New/pending questions, private answers, and dismissals are never pushed to peers; only staff-published (`isPublic`) answers (`updated`) and deletions of already-public rows (`deleted`) are broadcast. Non-broadcast content still reaches the intended viewer via the mutation response and the durable `clarification_answered` notification. See the `publishClarificationEvent` call sites in `packages/application/src/clarification/mutations.ts`.

## Scoreboard

Contest leaderboard **data** is not stored in Redis. It is computed on read directly from PostgreSQL (`getScoreboard` in `packages/application/src/contest/scoring.ts` reads `contest.participations` + submissions and calls `buildScoreboard`), including ICPC/IOI ranking and freeze (gated by the `Contest.frozenBoard` / `Contest.frozenAt` columns, which cut off submissions after the freeze point). Redis does carry the **live-update signal**: a successful contest judge calls `publishScoreboardUpdate`, which (throttled once per 10 s per contest via `nojv:sb-throttle:{id}`) publishes a `scoreboard:update` event on `nojv:contest:{id}`; the page's scoreboard SSE stream nudges connected viewers to re-fetch, with a 30 s poll as fallback. See [Judge Pipeline](./JUDGE_PIPELINE.md) and [Architecture Overview](./ARCHITECTURE.md).

## Submit Cooldown

Cooldown enforcement lives in the database — see `checkExamSubmitCooldown` in `packages/application/src/exam/mutations.ts`, which reads the user's most recent submission via `submissionRepo.findMostRecent`.

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
- In production, each limiter holds a dedicated ioredis connection (`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`). If Redis is unreachable, `consume()` rejects quickly and the wrapper converts the error to `RateLimiterFailClosedError`, which the caller maps to HTTP 429. Dev mode uses `RateLimiterMemory` instead.

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
