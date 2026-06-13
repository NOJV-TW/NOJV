# NOJV Web

> SvelteKit 前端 + SSR API routes，使用者進入系統的單一入口。

## 職責

- 渲染所有頁面（題目、提交、課程、比賽、考試、儀表板、後台）
- 對外提供 SSR API routes（`/api/**`）給瀏覽器與第三方
- 處理使用者認證、表單驗證、檔案上傳的 framework 接面
- 委派業務邏輯給 `@nojv/application`，本身只做 presentation 與 transport
- **不負責**：直接呼叫 Prisma（除 better-auth adapter 外）、定義 workflow、跑 sandbox

## 主要入口

- `src/hooks.server.ts` — 安全 headers、CSP、i18n、auth context
- `src/lib/auth.ts` — better-auth 設定（唯一使用 `prismaAdapterClient` 的位置）
- `src/lib/server/api/handlers.ts` — `apiHandler` / `writeApiHandler` / `requireApiAuth`
- `src/lib/server/auth/actor-context.ts` — `getActorContext` / `requireAuth`
- `src/lib/server/shared/form-utils.ts` — 表單 helpers（readString / readCheckbox / parseJsonField）
- `src/routes/(app)/**` — 應用頁面群
- `src/routes/api/**` — API endpoints

## 依賴

- 上游：`@nojv/core`、`@nojv/application`、`@nojv/db`（僅限 better-auth adapter）、`@nojv/redis`、`@nojv/storage`
- 透過 HTTP/Temporal client：dispatch 至 `@nojv/worker` 的 workflow
- 下游：終端使用者瀏覽器

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/web dev          # http://localhost:5173
pnpm -F @nojv/web build
pnpm -F @nojv/web check        # svelte-check
pnpm -F @nojv/web lint
```

## 相關文件

- [Frontend Surface](../../docs/architecture/FRONTEND.md)
- [Design Rules](../../docs/architecture/DESIGN.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Security Requirements](../../docs/operations/SECURITY.md)
