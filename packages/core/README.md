# @nojv/core

> 跨 package 共用的 Zod schemas、型別、常數，依賴金字塔的最底層。

## 職責

- 定義 problem、course、contest、exam、submission、user 等 domain 物件的 Zod schema
- 集中管理 enum 與常數（sandbox 限制、reserved username、語言模板、judge environment）
- 提供 `required-paths` 等共用 validation helper
- **不負責**：DB I/O、Redis、業務規則、UI、framework 整合

## 主要 API

- `src/schemas/problem.ts` — problem / judge-config schema
- `src/schemas/submission.ts` — submission verdict、subtask、score schema
- `src/schemas/judge-config.ts` — judge pipeline 設定
- `src/schemas/advanced-mode.ts` — advanced mode（自訂 docker image）schema
- `src/sandbox.ts` — sandbox request/result contract and limits
- `src/judge-environment.ts` / `judge-environment.json` — pinned compiler/runtime environment
- `src/judge-execution.ts` — judge execution state、dispatch kind、stage size、priority key
- `src/sse-events.ts` — SSE event 常數與 `sseEventSchema`
- `src/workflow-types.ts` — workflow input/output contracts; queue names live in `packages/temporal`
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
