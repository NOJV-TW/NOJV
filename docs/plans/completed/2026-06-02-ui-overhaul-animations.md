# UI 重構：作答頁版面修復 + 全站克制動畫 + UX 功能批次

狀態：active（2026-06-02 起）
分支：`feat/ui-overhaul-animations`

## 目標

保留現有架構與 design token 清晰度，達成三件事：

1. **A — 作答頁版面修復**：footer 不再把題目上滑、底部 border 完整可見、Nav↔題目 gap 縮小且隨螢幕高度自適應。
2. **B — 全站克制動畫潤飾**：遵守進場 ≤700ms / hover ≤160ms，聚焦共用 primitive，尊重 `prefers-reduced-motion`。
3. **C — UX 功能批次**（做 1–7、9，**不做 #8 diff**）。

## A. 版面修復

根因：5 個作答頁（`/problems/[id]`、`assignments|exams|contests/.../problems/[id]`、`contests/.../virtual/problems/[id]`）共用 `(app)/+layout.svelte`，該 layout 套 `pt-6/pb-10` 並渲染 `Footer(mt-16)`，加上 `ProblemSolveView` 的 `h-[calc(100dvh-7rem)]` magic number → 總高超過 100dvh → 整頁捲動、footer 推擠、底部 border 被裁。

改動：

- `(app)/+layout.svelte`：以 `page.route.id?.endsWith("/problems/[problemId]")` 判斷 immersive。immersive 時容器 `h-dvh overflow-hidden`、`main` 用 `flex-1 min-h-0 pt-3`（gap 24→12px）、不渲染 Footer、底部 `pb-4`。
- `ProblemSolveView.svelte`：`h-[calc(100dvh-7rem)]` → `h-full`。
- exam `+page.svelte`：wrapper `min-h-screen` → `h-full`，內層 `flex-1 min-h-0`。

## B. 動畫潤飾

- 路由轉場輕量 fade（~200ms）。
- 列表 stagger 進場（每項 ~30ms delay，整體 ≤700ms）：題目卡 / 提交列 / 排行榜。
- Skeleton 載入態（沿用 `shimmer` keyframe）。
- verdict badge 進場（AC 用 `--ease-spring` 微彈一次）。
- hover/focus 收斂到 Card/Button primitive。
- 全域 `prefers-reduced-motion` 關閉動畫。

## C. 功能（1–7、9）

1. 作答頁鍵盤快捷鍵：Ctrl/Cmd+Enter 提交、Ctrl/Cmd+S 存草稿、`[`/`]` 切題。
2. 程式碼草稿自動儲存（localStorage，per problem+language）。
3. 提交後 verdict 動畫 + 音效/震動（可關，偏好存 localStorage）。
4. 考試多題進度迷你地圖（AC/WA/未作答狀態一覽）。
5. 左右面板寬度持久化 + 雙擊重置。
6. 命令面板（⌘K）：跳題、切頁、搜尋題目。
7. 深色模式跟隨系統 / 排程。
8. a11y：focus trap、skip-link、鍵盤可達抽屜。

## 驗證

- `pnpm --filter @nojv/web check`（svelte-check 0 error）
- `pnpm lint && pnpm format`
- `pnpm test:unit`（autosave / theme schedule / shortcut 邏輯加單元測試）
- 邏輯密集處走 TDD；純 CSS/版面以 typecheck + 人工目視驗。

## 執行順序

A（基礎、快）→ B（共用 primitive）→ C5/C1/C2（editor cluster，循序避免衝突）→ C3/C4 → C6/C7/C9。
