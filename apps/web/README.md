# NOJV Web

> SvelteKit 前端 + SSR API routes，使用者進入系統的單一入口。Routes、gates 與 request pipeline 見 [Frontend Surface](../../docs/architecture/FRONTEND.md)；視覺規則見 [Design Rules](../../docs/architecture/DESIGN.md)。

## 職責

- 渲染所有頁面（題目、提交、課程、作業、考試、比賽、儀表板、後台）
- 提供 `/api/**` server endpoints 與 OpenAPI 文件（`/docs`、`/docs/internal`）
- 處理認證、表單驗證、檔案上傳、SSE 等 framework 接面
- 業務邏輯委派給 `@nojv/application`，本身只做 presentation 與 transport
- **不負責**：業務規則、直接呼叫 Prisma（`@nojv/db` 只用於 `src/lib/auth.server.ts` 的 Better Auth adapter）、定義 workflow、執行 sandbox

## 主要入口

- `src/hooks.server.ts` — request pipeline；`$lib/server/otel` 的 import 必須維持第一行
- `src/lib/auth.server.ts` — Better Auth 設定與 Prisma adapter
- `src/lib/server/` — server-only 的 auth、transport wrappers、OpenAPI、storage、registry adapters
- `src/lib/server/domain-orchestration.ts` — 啟動時把 application orchestration port 綁到 `@nojv/temporal`
- `src/lib/components/features/<domain>/` — 領域 UI；`primitives/` 保持與領域無關
- `src/routes/(app)/**` 需登入頁面、`(auth)/**` 登入流程、`(public)/**` 公開頁面、`api/**` endpoints
- 只在單一 route 使用的元件放在該 route 旁；server-only 模組放在 `src/lib/server/`（依 [SvelteKit project structure](https://svelte.dev/docs/kit/project-structure)）

## 依賴

- 上游：`@nojv/core`、`@nojv/application`、`@nojv/mailer`、`@nojv/redis`、`@nojv/storage`、`@nojv/temporal`；`@nojv/db` 僅限 auth wiring
- Workflow 經由 Temporal 派送給 `@nojv/worker`
- 下游：使用者瀏覽器、API token 用戶端

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/web dev          # http://localhost:5173
pnpm -F @nojv/web build
pnpm -F @nojv/web check        # paraglide compile + svelte-check
pnpm -F @nojv/web lint
```

## 相關文件

- [Frontend Surface](../../docs/architecture/FRONTEND.md)
- [Design Rules](../../docs/architecture/DESIGN.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Security Requirements](../../docs/operations/SECURITY.md)
