# @nojv/redis

> Redis 8 連線、key / channel registry、pub/sub helper。

## 職責

- 連線 factory（共用 client、SSE subscriber、rate-limiter 專用連線）
- 所有 key 與 channel 名稱集中於 `keys`
- best-effort publish helper
- **不負責**：業務規則、快取邏輯（在 `@nojv/application`）、rate limiter（在 `apps/web`）

## 主要 API

- `src/connection.ts` — `getRedis()`、`createSubscriber(redisUrl)`、`createRateLimiterConnection()`
- `src/keys.ts` — `keys` registry
- `src/pubsub.ts`（`pubsub` namespace）— `publishVerdict`、`publishScoreboardUpdate`、`publishContestEvent`、`publishNotification`、`publishClarification`

Key、TTL、channel 與事件一覽見 [Redis Architecture](../../docs/architecture/REDIS.md)。

## 依賴

- 上游：`@nojv/core`、`ioredis`
- 下游：`@nojv/application`、`apps/web`（僅 ARCHITECTURE 列出的檔案）、`apps/worker`

## 本地開發

```bash
pnpm -F @nojv/redis build
pnpm -F @nojv/redis typecheck
pnpm -F @nojv/redis lint
```

需先啟動本地 Redis（見 `docker-compose.yml`）。
