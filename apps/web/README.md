# NOJV Web

> SvelteKit 前端 + SSR API routes，使用者進入系統的單一入口。

## 職責

- 渲染所有頁面（題目、提交、課程、比賽、考試、儀表板、後台）
- 對外提供 SvelteKit server endpoints（`/api/**`）及 OpenAPI contract 文件
- 處理使用者認證、表單驗證、檔案上傳的 framework 接面
- 委派業務邏輯給 `@nojv/application`，本身只做 presentation 與 transport
- **不負責**：業務規則、直接呼叫 Prisma（僅 `auth.server.ts` adapter 及限定 hook）、定義 workflow、跑 sandbox

## 主要入口

- `src/hooks.server.ts` — server hook pipeline; auto-instrumentation must remain first
- `src/lib/auth.server.ts` — Better Auth configuration and the raw Prisma adapter
- `src/lib/server/` — server-only transport, auth, OpenAPI and storage adapters
- `src/lib/components/features/<domain>/` — domain UI; `primitives/` stays domain-agnostic
- `src/routes/` — SvelteKit page and API entry points
- Keep route-only components with their route, and server-only adapters under `src/lib/server/`, following [SvelteKit's project structure](https://svelte.dev/docs/kit/project-structure).
- `src/routes/(app)/**` — 應用頁面群
- `src/routes/api/**` — API endpoints

## 依賴

- 上游：`@nojv/core`、`@nojv/application`、`@nojv/mailer`、`@nojv/redis`、`@nojv/storage`、`@nojv/temporal`; `@nojv/db` is limited to auth wiring
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
