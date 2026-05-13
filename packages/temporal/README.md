# @nojv/temporal

> Temporal workflows、activities 與 task queue 定義。worker 啟動時註冊的 task queue 內容。

## 職責

- 定義所有 workflow（submission judge、rejudge、contest/assessment lifecycle、exam auto-close、plagiarism）
- 定義所有 activity（judge bundle、platform bundle、plagiarism、lifecycle、utils）
- 集中管理 task queue 名稱與 activity options（retry policy、timeout）
- activity 是「薄封裝」：呼叫 `@nojv/domain` 完成業務邏輯，不直接碰 Prisma
- **不負責**：dispatch workflow（那是 `@nojv/job-dispatch`）、長駐 worker 程序（那是 `apps/worker`）

## 主要入口

- `src/index.ts` — 對外型別與 task queue 常數
- `src/workflows/index.ts` — workflow 集合（`./workflows` subpath export）
- `src/activities/index.ts` — activity 集合（`./activities` subpath export）
- `src/activities/judge-bundle.ts` — judge worker 註冊用 bundle
- `src/activities/platform-bundle.ts` — platform worker 註冊用 bundle
- `src/workflows/submission-judge.ts` — 提交判題主流程
- `src/workflows/contest-lifecycle.ts` — 比賽 start / freeze / end
- `src/workflows/plagiarism-check.ts` — MOSS / Dolos 抄襲檢測流程

## 依賴

- 上游：`@nojv/core`、`@nojv/domain`、`@nojv/redis`、`@temporalio/*`、`@dodona/dolos-*`
- 下游：`apps/worker`（註冊並執行）、`@nojv/job-dispatch`（透過 workflow type）

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/temporal build
pnpm -F @nojv/temporal typecheck
```

## 相關文件

- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Reliability Invariants](../../docs/operations/RELIABILITY.md)
