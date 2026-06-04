# Rejudge 可視化 + 維運補洞 + 作業提交次數重置 設計／實作計畫

> 2026-06-04。一個 PR 交付。Brainstorm 定案,動工前最後確認 scope。

## Shipped (branch `feat/rejudge-ops-attempt-limit`)

全 6 項交付,`ci:verify` 各階段全綠(format / lint / typecheck / build /
unit 753 / integration 298)。與下方初始設計的差異(brainstorm 中演進):

- **重置時間精度**:`attemptResetHour`(整點)→ **`attemptResetMinuteOfDay`**
  (0–1439,台北分鐘精度),預設 **05:00 (300)**,全系統 fallback 一致
  (`DEFAULT_ATTEMPT_RESET_MINUTE`)。
- **D(rejudge 不扣次數)** 併入 **E** 的 integration(真 DB 驗重判後 attempt
  count 不變),而非獨立 unit mock。
- **A 端點權限** 採 capability-token 模型(`requireApiAuth` + workflowId 由發起
  POST 回傳、含毫秒 timestamp、cancel 非破壞性)。
- **Scope 取捨**:A 的 query/cancel 端點 integration(依賴 temporal server,薄
  wrapper)+ `/api/notifications` route 測試(與本 PR 無關)刻意未寫。
- **score_rejudged 學生通知**:維持 by-design 靜默,不做(使用者裁示)。

## 背景

回答「功能還缺什麼」時盤點延後清單,校正後三項(K8s 判題隔離、plagiarism
exam/contest diff、judgeMessage staff 分流)其實**已完成**。實際待補 5 項,
brainstorm 過程中使用者再追加 1 個新功能(作業提交次數重置)。`#5
score_rejudged 通知`使用者裁示**維持靜默、不做**。

## Scope(最終)

| 代號 | 項目                                                                                     | 類型               |
| ---- | ---------------------------------------------------------------------------------------- | ------------------ |
| A    | Rejudge 進度顯示 + 批次取消                                                              | 功能(原 #3)        |
| B    | Admin rejudge log 列表頁                                                                 | 功能(原 #4)        |
| C    | 作業提交次數:每題獨立 + 老師可設重置鐘點 + 學生可見 + 用盡 disabled                      | 新功能             |
| D    | rejudge 不扣學生提交次數 —— regression 測試釘住不變式                                    | 正確性(原 #1 確認) |
| E    | 補 route-level integration 測試(`/api/admin/*`、`/api/notifications/*`、`/api/rejudges`) | 維運(原 #7)        |
| F    | DATABASE.md 加 mermaid ER diagram                                                        | 維運(原 #8)        |
| G    | moderate 相依漏洞:盤點 + 分類處理 + 設定更新節奏                                         | 維運(原 #9)        |

**已確認排除**:score_rejudged 學生通知(維持 by-design 靜默)。

---

## A. Rejudge 進度顯示 + 批次取消

### 現況

- `POST /api/rejudges` → `dispatchRejudge` batch → 回 `{ workflowId }` 202,fire-and-forget。
- `rejudgeWorkflow` 有 `getProgressQuery`(`{ completed, total }`),用 `executeChild` 分批 dispatch。
- `temporal/dispatch.ts:97 queryRejudgeProgress(workflowId)` **已存在**,但無 web 端點使用。
- 無 cancel 路徑;workflow 未處理 cancellation。

### 改動

1. **temporal**:新增 `cancelRejudge(workflowId)` → `client.workflow.getHandle(workflowId).cancel()`。export 自 `@nojv/temporal`。
2. **workflow**:`rejudgeWorkflow` 確認 cancellation 語意——外部 cancel 時正在 await 的 `executeChild`/`Promise.all` 收到 `CancelledFailure`,迴圈中止,workflow 以 cancelled 結束;`completed` 停在當下。已完成的重判不回滾(重判冪等,可接受)。在 batch 迴圈外不額外 catch,讓 cancellation 自然傳播。
3. **web 端點**:
   - `GET /api/rejudges/[workflowId]` → `queryRejudgeProgress`,回 `{ completed, total }`(workflow 已結束時 query 會失敗 → 回 `{ done: true }`,前端據此停止輪詢)。
   - `POST /api/rejudges/[workflowId]/cancel` → `cancelRejudge`。
   - 權限:兩端點都要 `requireApiAuth` + 限能觸發 batch rejudge 的 staff;workflowId 不含 context 難精準授權,MVP 採「platformRole staff/admin 才可查/取消」,實作時對齊 `assertBatchRejudgeAccess` 的角色面。
4. **UI**(`RejudgeDialog.svelte`):送出後不立即關閉,切到「進度視圖」——進度條 `completed/total` + 每 1.5s 輪詢 GET 端點 + 「取消」鈕(呼叫 cancel 端點)。完成或取消後顯示結果 toast 再關閉。

### 測試

- workflow cancellation 中止迴圈(mock executeChild 拋 CancelledFailure)。
- 端點權限 + query/cancel 流程(integration,與 E 合併)。

---

## B. Admin rejudge log 列表頁

### 現況

`submissionRejudgeLogRepo` 只有 `listBySubmission` / `listForSubmissionIds`;
rejudge log 僅在 Audit Timeline 以混合事件流看單筆,無專屬列表。

### 改動

1. **repo**:新增 `listPaged({ limit, cursor, problemId?, rejudgedByUserId? })` —— 全表分頁 + 可選篩選,join submission/problem/user 取顯示欄位。
2. **domain**:`submissionDomain` 加 query wrapper + 授權(admin only,對齊現有 admin 頁慣例)。
3. **route + UI**:admin 區新增 `/(app)/admin/rejudges` 列表頁——表格(時間、提交、題目、觸發者、舊→新 verdict/score),cursor 分頁,problemId 篩選。沿用現有 admin 列表頁版式。
4. nav:admin 面板加入口。

### 測試

- repo 分頁 + 篩選(integration)。
- route 授權(非 admin 403)。

---

## C. 作業提交次數:每題獨立 + 重置鐘點 + 學生可見

### 資料模型

- `CourseAssessment` 加 `attemptResetHour Int?`(0–23)。台北時區(`Asia/Taipei`)解釋。`null` → 視為 `0`(午夜重置),向後相容。
- `maxAttemptsPerDay` 語意改:**每題**每窗口上限(原為整作業共用)。
- schema 直接 `db push`(dev,無正式資料)。

### 窗口計算(單一真相 helper)

新增 `attemptWindowStart(resetHour: number, now: Date): Date`:以 `Asia/Taipei`
把 `now` 換算,找出「最近一次經過 resetHour 整點」的台北時刻,轉回 UTC `Date`。
enforcement 與顯示共用此 helper。

### Enforcement(`assertDailyAttemptLimit`)

- 窗口起點改用 `attemptWindowStart(assignment.attemptResetHour ?? 0, now)`。
- count + advisory lock key 加 `problemId` → 每題獨立。
- 新 repo method `countForUserAssessmentProblemSince(userId, assessmentId, problemId, since)`。

### 顯示(沿用現有 badge,不另造)

- `+page.server.ts`:`countAssignmentSubmissionsToday` → 改帶 `problemId` + 用窗口 helper;`dailyAttempts` prop 加 `resetHour`。
- `ProblemDescriptionPanel.svelte`:既有「今日提交 `used/max`」badge 下加「於 HH:00 重置」;`remaining===0` 顯示「已達今日上限,將於 HH:00 重置」。
- **提交鈕 disabled**:`remaining===0` 狀態從 server load 多傳一條到 `ProblemWorkspace`/提交鈕,用盡時 disable(server `assertDailyAttemptLimit` 仍是最終防線)。

### 老師端

- `AssignmentSettingsTab.svelte` + 新建作業頁:`maxAttemptsPerDay` 旁加「重置時間」整點選擇器(0–23,標台北時區),僅在有設上限時有意義。
- core schema 4 處加 `attemptResetHour: z.coerce.number().int().min(0).max(23).nullish()`。
- 修文案 `assignmentCreate_maxAttemptsDesc`(現寫死「每日凌晨 0:00 重置」)反映設定值;`maxAttempts` 說明補「每題獨立計算」。

### 測試

- `attemptWindowStart` 各 resetHour / 跨日邊界。
- `assertDailyAttemptLimit` 每題獨立(A 題用盡不擋 B 題)+ reset 窗口。

---

## D. rejudge 不扣次數 — regression

確認現況正確:rejudge 走 `submission-judge` workflow 直接重判既有 submission,
**不經過** `createQueuedSubmissionRecord` 的 cooldown/attempt 路徑。加一個 domain
測試釘住「rejudge 既有 submission 不增加該生該題 attempt count」這個不變式,
避免日後 C 的改動或重構誤把 rejudge 接進計數路徑。

---

## E. Route-level integration 測試補洞

新增 integration:

- `/api/rejudges`(dispatch 授權 + A 的 query/cancel 端點)。
- `/api/admin/*`(B 的列表 + 既有 admin 端點授權)。
- `/api/notifications/*`(目前僅 domain-level,無 route 測試)。

---

## F. ER diagram

`docs/architecture/DATABASE.md` 加 mermaid `erDiagram`,涵蓋核心實體與關係
(User / Course / CourseAssessment / Problem / Submission / Contest / Exam\* /
SubmissionRejudgeLog 等),補 Quality Ledger 標的「Add an entity-relationship
diagram」。不取代既有自動產生的 `DATABASE.generated.md` 欄位參考。

---

## G. moderate 相依漏洞

1. 跑 `pnpm audit --audit-level moderate` 盤點現況(數量、套件、是否 transitive)。
2. 逐一分類:可升級的升;FP / 無修補 / 無實際暴露的記錄理由。
3. 在 docs(SECURITY.md 或 QUALITY_SCORE.md)寫明依賴更新節奏(cadence),
   對齊 Quality Ledger 的 next-upgrade。
4. CI 是否升 moderate gate:預設**不升**(避免 transitive moderate 卡 CI),
   除非盤點後判定可控——此決策實作時帶數據再定。

---

## 實作順序

1. C 資料模型 + 窗口 helper + enforcement(TDD)
2. C 顯示 + 老師端 UI
3. D regression 測試
4. A workflow/temporal/端點 + UI
5. B repo/domain/route/UI
6. E integration 測試
7. F ER diagram
8. G audit 盤點 + 文件
9. `pnpm ci:verify` 全綠 → 一個 PR

## 驗證

- 每功能 TDD:先寫失敗測試再實作。
- 收尾 `pnpm ci:verify`(format / db:generate / build / lint / typecheck / test)。
- C 的窗口/時區與 A 的 cancellation 是最易出錯處,測試重點。
