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
- `src/repositories/*.ts` — 每個 aggregate 一個 repository facade；submission 查詢按 identity、history、statistics、lifecycle 拆在 `src/repositories/submission/`
- `src/repositories/submission/shared.ts` — 共用查詢範圍、select 與建立 context；不要在 application 重複維護 Prisma 查詢條件
- `src/transaction.ts` — `runTransaction(fn)` + `TransactionClient` 型別
- `prisma/schema/*.prisma` — schema 主檔（user、problem、contest、course、submission 等）
- `prisma/migrations/` — migration 歷史
- `prisma/seed.ts` — 本地開發 seed 的順序與安全閘；主題資料在 `prisma/seeds/`
- `prisma/seeds/announcements.ts` — demo 公告資料
- `prisma/scripts/deploy-release.sh` — Helm migrator hook：有 pending migration 時排空 web 與 workers 後才 `prisma migrate deploy`

## 依賴

- 上游：`@nojv/core`；`@nojv/storage` 僅供 Prisma seed 使用，不得由 `src/` 匯入
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

修改 submission 查詢時，從 `src/repositories/submission.ts` 的 `submissionRepo` facade 找到對應責任模組；history 查詢的 unit 覆蓋位於 `tests/unit/db/submission-history.test.ts`。Schema 與資料變更規則仍以 Database Schema 文件和 migration guard 為準。
