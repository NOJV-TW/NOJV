# @nojv/core

> 跨 package 共用的 Zod schemas、型別、常數，依賴金字塔的最底層。

## 職責

- 定義 problem、course、contest、exam、submission、user 等 domain 物件的 Zod schema
- 集中管理 enum 與常數（task queue 名稱、sandbox 限制、reserved username、語言模板）
- 提供 `required-paths` 等共用 validation helper
- **不負責**：DB I/O、Redis、業務規則、UI、framework 整合
- 嚴禁依賴任何 `@nojv/*` 內部 package

## 主要 API

- `src/schemas/problem.ts` — problem / judge-config schema
- `src/schemas/submission.ts` — submission verdict、subtask、score schema
- `src/schemas/judge-config.ts` — judge pipeline 設定
- `src/schemas/advanced-mode.ts` — advanced mode（自訂 docker image）schema
- `src/queue.ts` — Temporal task queue 名稱常數
- `src/sandbox.ts` — sandbox 預設限制與型別
- `src/reserved-username.ts` — 保留 username 黑名單

## 依賴

- 上游：無（僅 `zod`）
- 下游：所有其他 `@nojv/*` package 與 apps

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/core build
pnpm -F @nojv/core typecheck
pnpm -F @nojv/core lint
```

## 相關文件

- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
