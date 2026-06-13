# @nojv/db

> Prisma 7 schema、migrations、與 repository function。資料存取層。

## 職責

- 維護 PostgreSQL schema（多檔結構於 `prisma/schema/*.prisma`）
- 管理 migration 與 seed
- 對外暴露 repository function 與 type，封裝 Prisma 查詢
- **不對外暴露 raw `PrismaClient`**。例外：`prismaAdapterClient` 給 better-auth 用（framework adapter）
- **不負責**：業務邏輯（在 `@nojv/application`）、權限判斷、Redis 快取

## 主要 API

- `src/index.ts` — 對外 surface：`repositories.*`、`runTransaction`、`Prisma` namespace、enum re-exports
- `src/repositories/*.ts` — 每個 aggregate 一份 repository
- `src/transaction.ts` — `runTransaction(fn)` + `TransactionClient` 型別
- `prisma/schema/*.prisma` — schema 主檔（user、problem、contest、course、submission 等）
- `prisma/migrations/` — migration 歷史
- `prisma/seed.ts` — 本地開發 seed

## 依賴

- 上游：`@nojv/storage`（特定 repository 需要清資源時呼叫）
- 下游：`@nojv/application`、`apps/web` 的 better-auth adapter、`apps/worker`

## 本地開發

```bash
# 從 repo 根目錄
pnpm db:generate              # 重新產 Prisma client
pnpm db:push                  # 推 schema 到本地 DB（dev）
pnpm db:migrate               # 跑 migration（含建 migration）
pnpm db:seed                  # 灌種子資料
pnpm -F @nojv/db typecheck
```

## 相關文件

- [Database Schema](../../docs/architecture/DATABASE.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Backup & Restore](../../docs/runbooks/backup-restore.md)
