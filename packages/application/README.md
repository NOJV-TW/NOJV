# @nojv/application

> 業務邏輯層。所有 query、mutation、權限、評分都在這。apps 唯一該呼叫的業務介面。

## 職責

- 封裝所有 domain 操作（題目、課程、比賽、考試、提交、抄襲、通知、評分、計分板）
- 處理權限判斷（`canManageContest`、`canManageExam`、`assertProblemEditAccess` 等）
- 對 DB / Redis / Storage / mailer 做組合與交易控制；Temporal 操作經由 `DomainOrchestrationAdapter` port（`src/shared/orchestration.ts`）
- 計分、scoreboard 更新、adjustment rule 套用
- **不負責**：HTTP 解析、SvelteKit `RequestEvent`、Temporal client/worker 設定

Import 限制見 [Architecture — Dependency Rules](../../docs/architecture/ARCHITECTURE.md#dependency-rules)。

## 主要 API

- `src/index.ts` — 對外用 namespace export（`problemDomain`、`submissionDomain`、`contestDomain`、`courseDomain`、`examDomain`、`assignmentDomain`、`apiTokenDomain`、`registryDomain`、`notificationDomain`、`plagiarismDomain`、`scoring` 等）與共用 helper
- `src/contest/permissions.ts` — `canManageContest`
- `src/exam/permissions.ts` — `canManageExam`
- `src/problem/{details,list,picker}.ts` — 題目詳情、公開／管理列表與選題器資料
- `src/problem/mutations/{records,publishing,judge-config}.ts` — 題目紀錄、發布及評測設定寫入
- `src/submission/{details,history,judge-context}.ts` — 提交詳情、列表及評測上下文讀取
- `src/submission/{creation,judge-lifecycle,verdict-summary}.ts` — 提交建立、評測完成／重判狀態及結果摘要
- `src/submission/{judge-execution,judge-recovery,rejudge-control}.ts` — durable judge execution、dispatch 順序與復原、重判操作
- `src/scoring/` — adjustment rule、subtask scoring、scoreboard 計算
- `src/shared/list-aggregations.ts` — 作業／考試列表以批次查詢取得活動分數與人工覆寫；按活動分組，考試各自保留嚴格截止時間，作業不套用考試截止規則
- `src/shared/` — 共用 helper（`ip.ts`、actor context、error classes、orchestration port、storage object lifecycle、lifecycle reconciler）

修改以上流程時，同步更新對應 feature spec 或架構文件；從 repo 根目錄執行 `tests/unit/application/` 的相關測試，並在跨服務或持久化邊界變更時執行對應 integration suite。

## 依賴

- 上游：`@nojv/core`、`@nojv/db`、`@nojv/mailer`、`@nojv/redis`、`@nojv/storage`
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
