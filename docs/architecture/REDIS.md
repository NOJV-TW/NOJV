# Redis Architecture

Redis 8 carries pub/sub fan-out for SSE, cross-instance rate limits, short-lived
security proofs, read-through caches and cache leases. PostgreSQL is the source
of truth: never store anything in Redis that cannot be rebuilt from it (DAT-10).
All keys and channels come from one registry (DAT-09).

## Key code

- `packages/redis/src/keys.ts` — every key and channel name
- `packages/redis/src/connection.ts` — `getRedis()`, `createSubscriber()`, `createRateLimiterConnection()`
- `packages/redis/src/pubsub.ts` — best-effort `publish*` helpers
- `packages/core/src/sse-events.ts` — SSE event constants and `sseEventSchema`
- `apps/web/src/lib/server/shared/rate-limiter.ts` — all rate limiters
- `apps/web/src/lib/server/shared/{sse-hub,sse-response,sse-slot}.ts` — SSE plumbing
- `packages/application/src/contest/scoring.ts` — scoreboard cache and lease
- `packages/application/src/api-token/{step-up,security-settings}.ts` — security proof keys

## Keys

All keyed state uses the `nojv:` prefix except rate-limiter keys (`rl:*`).

| Key                                                             | TTL                                  | Writer / purpose                                                 |
| --------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `nojv:cache:admin-dashboard`                                    | 300 s                                | `adminDomain` dashboard read-through cache                       |
| `nojv:cache:platform-overview`                                  | 300 s                                | `platformDomain` site overview cache                             |
| `nojv:cache:platform-overview-lock`                             | 5 s (`SET NX`)                       | Rebuild lease for the platform overview                          |
| `nojv:sb-cache:{contestId}:{live\|public}`                      | 10 s                                 | Scoreboard cache (live = staff view, public = frozen-aware view) |
| `nojv:sb-chart-cache:{contestId}:{live\|public}:{topN}`         | 10 s                                 | Scoreboard chart cache                                           |
| `nojv:sb-lock:{contestId}:{live\|public}`                       | 5 s (`SET NX`, token)                | Scoreboard rebuild lease                                         |
| `nojv:sb-throttle:{contestId}`                                  | 10 s (`SET NX`)                      | Throttle for `scoreboard:update` publishes                       |
| `nojv:apitoken:stepup:{sessionId}`                              | 600 s                                | API-token step-up proof, bound to `securityGeneration`           |
| `nojv:apitoken:page-mfa:{sessionId}`                            | 3600 s                               | API-token page MFA proof                                         |
| `nojv:stepup:handoff:{ticket}`                                  | 60 s, `GETDEL`                       | One-shot step-up handoff ticket                                  |
| `nojv:security:settings-grant:{sessionId}`                      | 600 s                                | Security-settings unlock bound to session + `securityGeneration` |
| `nojv:security:pending-totp:{sessionId}`                        | 600 s                                | Encrypted TOTP secret and backup codes awaiting confirmation     |
| `nojv:security:setup-otp:{userId}` / `-attempts:{userId}`       | 600 s                                | Hashed email OTP for security setup; 5 attempts                  |
| `nojv:super-admin:password-proof:{ticket}`                      | 600 s                                | Password-first proof before super-admin MFA or recovery          |
| `nojv:super-admin:recovery-otp:{userId}` / `-attempts:{userId}` | 600 s                                | Super-admin recovery OTP; 5 attempts                             |
| `nojv:admin:mfa:{sessionId}`                                    | 600 s (regular) / 24 h (super admin) | Admin MFA proof                                                  |
| `nojv:admin:mode:{sessionId}`                                   | 7 d                                  | Regular-admin mode grant; never used by super admins             |
| `nojv:2fa:totp-seen:{userId}:{code}`                            | 120 s                                | TOTP replay guard                                                |
| `rl:*`                                                          | limiter window                       | `rate-limiter-flexible` counters                                 |

Security proofs fail closed when Redis is unavailable (DAT-12). Admin and
step-up semantics: [Security](../operations/SECURITY.md), SEC-04/05/08.

## Pub/Sub

Publishing is best-effort: `pubsub.ts` routes failures to
`setPubsubErrorHandler` and never throws into the caller.

| Channel                                              | Producer                                                | Consumer                                       |
| ---------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `nojv:user:{userId}`                                 | `publishVerdict`                                        | `/api/events/stream`                           |
| `nojv:notification:{userId}`                         | `publishNotification`, `publishNotificationBatchSignal` | `/api/events/stream`                           |
| `nojv:contest:{contestId}`                           | `publishContestEvent`, `publishScoreboardUpdate`        | `/contests/{contestId}/scoreboard/stream`      |
| `nojv:clarification:{contextType}:{contextId}`       | `publishClarification(…, "public")`                     | `/api/events/stream` (`canAsk \|\| canAnswer`) |
| `nojv:clarification-staff:{contextType}:{contextId}` | `publishClarification(…, "staff")`                      | `/api/events/stream` (`canAnswer` only)        |

Events (discriminator `type`, schema `sseEventSchema`):

| Event                | Payload                                                         | When                                                            |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `submission:verdict` | `submissionId, verdict, score, problemId`                       | Judge commits a verdict                                         |
| `scoreboard:update`  | —                                                               | Contest verdict; at most once per 10 s per contest              |
| `contest:starting`   | —                                                               | `contestLifecycleWorkflow` at start                             |
| `contest:ending`     | —                                                               | `contestLifecycleWorkflow` at end                               |
| `notification`       | `id?, notificationType, params, linkUrl, createdAt?`            | Durable notification; `id`/`createdAt` omitted on batch signals |
| `clarification`      | `action` (`created`/`updated`/`dismissed`/`deleted`), `payload` | Any clarification mutation                                      |

Clarification routing keeps unanswered and private content away from peers
(ASM-11): the public channel carries only public answers (`updated`) and
deletions of already-public rows; the staff channel carries new questions,
private answers, dismissals and deletions of private or pending rows. Call sites:
`packages/application/src/clarification/mutations.ts`.

### SSE endpoints

- `/api/events/stream` subscribes to the user, notification and authorized
  clarification channels (up to 25 `clarificationSub` query params).
- `/contests/{contestId}/scoreboard/stream` subscribes to the contest channel.
- Both share one process-wide subscriber (`sse-hub.ts`), send a keepalive every
  30 s and close after 3,500,000 ms; clients reconnect.
- Slots (`sse-slot.ts`): at most 5 streams per user per stream type and 2000 per
  process.

## Scoreboard

`getScoreboard` computes rankings and freeze from PostgreSQL
(`contestRepo.findForScoreboardById`) and caches the result per variant for
10 s. On a miss, one caller takes the `sb-lock` lease with a unique token and
recomputes; others poll the cache up to 5 times at 80 ms and then compute
themselves. The lease is released by an atomic Lua compare-and-delete. Any
Redis error falls back to direct computation, so Redis is an optimization, not
a consistency requirement (DAT-11). `getScoreboardChart` caches per `topN`
for 10 s on top of the scoreboard result and takes no lease.

## Rate limiting

`rate-limiter-flexible` in `apps/web/src/lib/server/shared/rate-limiter.ts`.

| Limiter                       | Prefix              | Limit      | Key                                      | Used by                                 |
| ----------------------------- | ------------------- | ---------- | ---------------------------------------- | --------------------------------------- |
| `apiRateLimiter`              | `rl:api`            | 300 / 60 s | `u:{userId}` or client IP                | Read API handlers (local fallback)      |
| `writeApiRateLimiter`         | `rl:write`          | 10 / 60 s  | `u:{userId}` or client IP                | Write API handlers                      |
| `draftApiRateLimiter`         | `rl:draft`          | 60 / 60 s  | `u:{userId}` or client IP                | `/api/drafts` autosave                  |
| `registryTokenRateLimiter`    | `rl:registry-token` | 60 / 60 s  | `u:{userId}` or client IP                | Registry token API handler              |
| `formActionRateLimiter`       | `rl:form`           | 20 / 60 s  | client IP                                | `withRateLimit` form actions            |
| `authRateLimiter`             | `rl:auth`           | 60 / 60 s  | client IP                                | All Auth API routes (`hooks.server.ts`) |
| `signInRateLimiter`           | `rl:signin`         | 5 / 15 min | client IP (`registry:{ip}` for registry) | Admin password sign-in, registry token  |
| `examSignInRateLimiter`       | `rl:exam-signin`    | 5 / 15 min | `[ip, normalized username]`              | Exam password sign-in                   |
| `otpSendRateLimiter`          | `rl:2fa-otp`        | 3 / 10 min | user ID                                  | Email OTP sends                         |
| `stepUpAttemptRateLimiter`    | `rl:stepup`         | 5 / 10 min | user ID                                  | Step-up verification attempts           |
| `remoteAssetFetchRateLimiter` | `rl:remote-fetch`   | 10 / 60 s  | client IP                                | `/api/images/proxy` (SEC-11)            |

- Client IP comes from `getClientIp(event)` (SEC-09). Malformed exam usernames
  share one bounded bucket per IP.
- Production: each limiter owns a lazy connection from
  `createRateLimiterConnection()` (`enableOfflineQueue: false`,
  `maxRetriesPerRequest: 1`); the first consumer awaits readiness. Operational
  Redis errors return `unavailable` (HTTP 503) except `apiRateLimiter`, which
  falls back to an in-process limiter (DAT-12).
- Development (`$app/environment` `dev`): in-memory limiters with 1000× points.

Submit cooldowns are not in Redis: `enforceSubmitCooldown`
(`packages/application/src/shared/submit-cooldown.ts`) checks the latest
submission under a PostgreSQL advisory lock.

## Connections

| Connection                        | Factory                         | Used by                     |
| --------------------------------- | ------------------------------- | --------------------------- |
| Shared command client (singleton) | `getRedis()`                    | application, web exceptions |
| Subscriber (one per web process)  | `createSubscriber(REDIS_URL)`   | `sse-hub.ts`                |
| Rate-limiter clients              | `createRateLimiterConnection()` | `rate-limiter.ts`           |

All read `REDIS_URL` via `parseRedisConnection` (`@nojv/core`). Web access
outside `@nojv/application` is limited to the files listed in
[Architecture](./ARCHITECTURE.md#dependency-rules).
