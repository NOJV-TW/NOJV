# @nojv/application

> 業務邏輯層。所有 query、mutation、權限、評分都在這。apps 唯一該呼叫的業務介面。

## 職責

- 封裝所有 domain 操作（題目、課程、比賽、考試、提交、抄襲、通知、評分、計分板）
- 處理權限判斷（`canManageContest`、`canManageExam`、`assertProblemEditAccess` 等）
- 對 DB / Redis / Storage / Temporal 做組合與交易控制
- 計分、scoreboard 更新、adjustment rule 套用
- **不負責**：HTTP 解析、SvelteKit `RequestEvent`、Temporal SDK 直接呼叫
- **嚴禁** import `@sveltejs/kit`、`@temporalio/*`（要 dispatch 走 `@nojv/temporal` 的 dispatch helpers；不能 import `@nojv/temporal/workflows`）

## 主要 API

- `src/index.ts` — 對外用 namespace export：`problemDomain`、`contestDomain`、`courseDomain`、`examDomain`、`submissionDomain`、`plagiarismDomain`、`scoring` 等
- `src/contest/permissions.ts` — `canManageContest`
- `src/exam/permissions.ts` — `canManageExam`
- `src/scoring/` — adjustment rule、subtask scoring、scoreboard 計算
- `src/shared/` — 共用 helper（`ip-utils`、actor 介面、error classes）

## 依賴

- 上游：`@nojv/core`、`@nojv/db`、`@nojv/redis`、`@nojv/storage`、`@nojv/temporal`
- 下游：`apps/web` 的 server routes、`apps/worker` 的 activities

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/application build
pnpm -F @nojv/application typecheck
pnpm -F @nojv/application lint
```

## 相關文件

- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
- [Database Schema](../../docs/architecture/DATABASE.md)
