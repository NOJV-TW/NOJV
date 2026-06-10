# @nojv/redis

> Redis 8 連線、key 註冊、pub/sub。

## 職責

- 集中管理 Redis 連線（singleton client + subscriber）與 key naming（`keys` registry）
- 提供 pub/sub helper 給 SSE 與 worker 之間溝通
- **不負責**：業務規則（誰能更新、何時 freeze 在 `@nojv/domain`）

## 主要 API

- `src/connection.ts` — `getRedis()`、`createSubscriber()`
- `src/keys.ts` — `keys` registry（所有 Redis key 命名集中於此）
- `src/pubsub.ts` — `publish` / `subscribe` helper

## 依賴

- 上游：`@nojv/core`（共享 schema）、`ioredis`、`@opentelemetry/api`
- 下游：`@nojv/domain`、`apps/web`、`apps/worker`、`@nojv/temporal`

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/redis build
pnpm -F @nojv/redis typecheck
pnpm -F @nojv/redis lint
```

需先啟動本地 Redis（見 `docker-compose.yml`）。

## 相關文件

- [Redis Architecture](../../docs/architecture/REDIS.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
