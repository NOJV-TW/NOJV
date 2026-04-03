# Redis Architecture

Redis 8 serves as the real-time data layer. It does not store durable state — PostgreSQL is the source of truth. Redis handles pub/sub, rate limiting, caching, scoreboards, and submit cooldowns.

## Key Naming Convention

All keys use the prefix `nojv:{domain}:{identifier}`.

| Pattern                              | Type                  | TTL                        | Purpose                    |
| ------------------------------------ | --------------------- | -------------------------- | -------------------------- |
| `nojv:scoreboard:{contestId}`        | Sorted Set            | None                       | Live contest scoreboard    |
| `nojv:scoreboard:{contestId}:frozen` | Sorted Set            | None                       | Frozen scoreboard snapshot |
| `nojv:cooldown:{userId}:{problemId}` | String                | Contest cooldown (seconds) | Submit rate limiting       |
| `nojv:cache:problems:list`           | String (JSON)         | 5 min                      | Problem list cache         |
| `nojv:cache:problem:{id}`            | String (JSON)         | 5 min                      | Problem detail cache       |
| `nojv:cache:contest:{slug}`          | String (JSON)         | 1 min                      | Contest detail cache       |
| `nojv:cache:course:{slug}`           | String (JSON)         | 5 min                      | Course detail cache        |
| `nojv:rl:{endpoint}:{userId}`        | rate-limiter-flexible | Per-endpoint               | API rate limiting          |

## Pub/Sub

**Channel**: `user:{userId}`

Used to push real-time events to authenticated users via SSE. The web app subscribes on `/api/events/stream` and keeps the connection open for up to 10 minutes with 30-second keepalive pings.

**Event Types** (defined in `@nojv/core`):

| Event                 | Payload                           | When                            |
| --------------------- | --------------------------------- | ------------------------------- |
| `submission:verdict`  | `{ submissionId, status, score }` | Submission judging completes    |
| `contest:starting`    | `{ contestId }`                   | Contest becomes active          |
| `contest:ending`      | `{ contestId }`                   | Contest ends                    |
| `assignment:deadline` | `{ assessmentId }`                | Assessment deadline approaching |

Events are published by Temporal activities (`publishVerdict`, `publishContestEvent`, `publishAssessmentDeadline`).

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
| Update score    | `ZADD nojv:scoreboard:{contestId} {score} {participationId}`            | After each submission verdict |
| Get leaderboard | `ZREVRANGE nojv:scoreboard:{contestId} {start} {stop} WITHSCORES`       | Scoreboard page load          |
| Freeze          | `RENAME nojv:scoreboard:{contestId} nojv:scoreboard:{contestId}:frozen` | At freeze time                |

After freeze, public reads go to the `:frozen` key. Admin/teacher can still read the live key.

## Submit Cooldown

Prevents rapid-fire submissions during contests. Cross-instance consistent via Redis.

```
SET nojv:cooldown:{userId}:{problemId} 1 EX {seconds} NX
```

- `NX` ensures atomic check-and-set
- If the key already exists, the submission is rejected (cooldown active)
- TTL matches the contest's `submitCooldownSec`

## Cache-Aside Pattern

Hot data is cached in Redis to reduce database load:

```
Read:  GET nojv:cache:{key} → hit? return : fetch DB → SET with TTL → return
Write: Mutate DB → DEL nojv:cache:{key}
```

Cache is never the source of truth. Stale reads are acceptable for list pages (5 min TTL). Contest data uses a shorter TTL (1 min) for fresher scoreboard state.

## Rate Limiting

Uses `rate-limiter-flexible` with Redis backend for cross-instance rate limiting:

- Applied to API routes that accept user input (submissions, plagiarism triggers)
- Key pattern: `nojv:rl:{endpoint}:{userId}`
- Configured per-endpoint with points and duration

## Connection Management

Both `apps/web` and Temporal activities use singleton Redis connections:

- **Web**: `getRedis()` in `$lib/server/redis.ts` (lazy init from `REDIS_URL`)
- **Worker**: Activities import from `@nojv/temporal/activities` which internally use `getRedis()`
- **Subscriber**: Separate connection created for pub/sub to avoid blocking the main connection

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Temporal Workflows](TEMPORAL.md)
- [Deployment Guide](DEPLOYMENT.md)
