# Redis Architecture

Redis 8 serves as the real-time data layer. It does not store durable state — PostgreSQL is the source of truth. Redis handles pub/sub, rate limiting, scoreboards, and metrics. (The submit-cooldown and cache modules ship as wired-up helpers but are not currently called — see notes below.)

## Key Naming Convention

Keyed state uses the prefix `nojv:{domain}:{identifier}` (applies to keyed state, not pub/sub channels — see `packages/redis/src/keys.ts:1-3`).

| Pattern                              | Type                  | TTL    | Purpose                                              |
| ------------------------------------ | --------------------- | ------ | ---------------------------------------------------- |
| `nojv:scoreboard:{contestId}`        | Sorted Set            | 90 d   | Live contest scoreboard                              |
| `nojv:scoreboard:{contestId}:frozen` | Sorted Set            | 90 d   | Frozen scoreboard snapshot                           |
| `nojv:cooldown:{userId}:{problemId}` | String                | varies | Submit cooldown — module currently unused (see note) |
| `nojv:cache:{key}`                   | String (JSON)         | varies | Cache-aside helper — currently unused (see note)     |
| `rl:*` (no `nojv:` prefix)           | rate-limiter-flexible | varies | API / form / sign-in rate limiting                   |

The scoreboard 90-day TTL is refreshed on every write (see `SCOREBOARD_TTL_SECONDS` in `packages/redis/src/scoreboard.ts:8`): active contests stay alive indefinitely, ended ones release memory after the grace window.

### Cache module — available but unused

`packages/redis/src/cache.ts` exports `cacheGet` / `cacheSet` / `cacheDel` with Zod-validated reads. The Temporal activity bundles re-export them for parity, but a repo-wide grep finds zero call sites in `packages/domain/` or `apps/`. No `nojv:cache:*` keys are ever written. Treat the module as a surface for future hot-path caching, not active production state.

### Cooldown module — available but unused

`packages/redis/src/cooldown.ts` (`setCooldown` / `checkCooldown`) is similarly dead code. The exam submit cooldown is enforced from the database — see `checkExamSubmitCooldown` in `packages/domain/src/exam/mutations.ts` (reads `submissionRepo.findMostRecent`). The Redis helper is retained for cross-instance enforcement should a future call path need it.

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

## Scoreboard (Sorted Sets)

Contest leaderboards use Redis sorted sets for O(1) score updates and O(log N + M) range queries.

### Score Encoding

| Mode | Score Formula                        | Notes                                   |
| ---- | ------------------------------------ | --------------------------------------- |
| ICPC | `solvedCount * 1e9 - penaltySeconds` | Higher = better. Penalty is time-based. |
| IOI  | `totalPoints`                        | Sum of per-problem best scores          |

### Operations

| Operation       | Redis Command                                                           | When                          |
| --------------- | ----------------------------------------------------------------------- | ----------------------------- |
| Update score    | `ZADD nojv:scoreboard:{contestId} {score} {participationId}` + `EXPIRE` | After each submission verdict |
| Get leaderboard | `ZREVRANGE … WITHSCORES` on frozen key if present, else live            | Scoreboard page load          |
| Freeze          | `ZRANGE` live → `ZADD` into `:frozen` (snapshot copy)                   | At freeze time                |
| Unfreeze        | `DEL nojv:scoreboard:{contestId}:frozen`                                | When the freeze window ends   |

Freeze is a snapshot copy, not a rename: the live key keeps accepting writes (so post-freeze submissions are not lost), and `getScoreboard` returns the frozen snapshot whenever the `:frozen` key exists — for every caller, regardless of role. Public and staff views are identical during the freeze window. Both keys get `EXPIRE SCOREBOARD_TTL_SECONDS` (90 days) refreshed on each write.

## Submit Cooldown

Cooldown enforcement currently lives in the database — see `checkExamSubmitCooldown` in `packages/domain/src/exam/mutations.ts`, which reads the user's most recent submission via `submissionRepo.findMostRecent`. The `packages/redis/src/cooldown.ts` helper (`SET nojv:cooldown:{userId}:{problemId} 1 EX {seconds} NX`) is wired and tested but currently has no production call sites.

## Cache-Aside Pattern

The `cacheGet` / `cacheSet` / `cacheDel` helpers in `packages/redis/src/cache.ts` implement a standard cache-aside flow with Zod-validated reads. They are not currently invoked from any domain command or query. Future hot-path callers should adopt the pattern:

```
Read:  cacheGet(key, schema) → hit? return : fetch DB → cacheSet(key, value, ttl) → return
Write: mutate DB → cacheDel(key)
```

Cache must never become the source of truth; stale reads must remain acceptable for any keyed surface.

## Rate Limiting

`rate-limiter-flexible` with a Redis backend (`apps/web/src/lib/server/shared/rate-limiter.ts`):

- Keyed on the Cloudflare-aware client IP via `getClientIp(event)`, not on userId.
- Key prefix is `rl` — no `nojv:` prefix.
- Four shared limiters, not per-endpoint:
  - `apiRateLimiter` — 60 req / 60 s
  - `writeApiRateLimiter` — 10 req / 60 s
  - `formActionRateLimiter` — 20 req / 60 s (consumed by `consumeFormRateLimit`)
  - `signInRateLimiter` — 5 attempts / 15 min (password sign-in)
- Dev / test multiply points by 10× to avoid E2E flakiness.
- In production, if Redis is unreachable at limiter construction time, the limiter fails closed (rejects every request) rather than falling back to per-instance memory.

## Observability

`packages/redis/src/metrics.ts` registers one OpenTelemetry histogram via the `@nojv/redis` meter:

- `scoreboard_update_latency_seconds` — recorded in `updateScoreboard` (try/finally so failure latency is captured too), attribute `mode` is `"icpc"` or `"ioi"`.

Exported through the project's OTLP pipeline; surface it on the Grafana scoreboard dashboard.

## Connection Management

Both `apps/web` and Temporal activities use singleton Redis connections from `@nojv/redis`:

- **Web**: imports `getRedis` (and `createSubscriber`, `keys`) directly from `@nojv/redis`. There is no `$lib/server/redis.ts` shim.
- **Worker / Temporal activities**: import via the activity bundles in `packages/temporal/src/activities/`, which re-export from `@nojv/redis`.
- **Subscriber**: a separate connection (`createSubscriber`) is created for pub/sub to avoid blocking the main connection.

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Deployment Guide](DEPLOYMENT.md)
