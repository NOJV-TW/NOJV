# Stale Submission Reaper(判題逾時保護)

## 問題

Submission 非終態有 `queued` / `compiling` / `running`。judge activity timeout(5m/10m ×3 重試)耗盡後 workflow 拋錯,但沒有任何機制把 submission row 收斂回終態——worker 死亡或 workflow 失敗時 submission 永遠卡住,且持續占用學生的每日提交次數。

## 決策

- **終態**:重用 `system_error`,不新增 enum 值。
- **返還次數**:次數計算(count submission rows)排除所有 `system_error`——平台故障一律不消耗次數,被 kill 的與既有 storage 故障等一視同仁。
- **偵測機制**:Temporal cron workflow(每分鐘)掃 DB,非懶性檢查。
- **門檻**:預設 30 分鐘,管理員可調(下限 10、上限 1440),存 DB。
- **UI 位置**:`/admin/rejudges` 頁面上方設定卡(使用者指定,不開新設定頁)。

## 設計

### 1. PlatformSetting table

key-value:`key String @id` + `value String` + `updatedAt`。第一個 key:`submission_pending_timeout_minutes`。無 row 時程式內預設 30。Zod 驗證:整數、10–1440。

Migration 檔 + dev `db push` 都要做(PR #105 教訓:不能只 push)。

### 2. Sweeper cron workflow

`submissionSweeperWorkflow`,固定 workflowId `submission-pending-sweeper`,`cronSchedule: "* * * * *"`,worker 啟動時 ensure(ALREADY_EXISTS 忽略)。每輪呼叫 sweep activity:

1. 讀 timeout 設定(每輪都讀,改設定即時生效)
2. 查 `status IN (queued, compiling, running) AND updatedAt < now() - threshold`
   - 用 `updatedAt`(狀態推進就會 bump),避免 rejudge 把舊 submission 改回 `queued` 時被 `createdAt` 誤殺
3. 逐筆(單筆失敗不影響其他筆):
   - terminate `judge-<submissionId>` workflow(不存在就忽略;用 terminate 不用 cancel——cancel 的還原 handler 會跟標 system_error 打架,且 terminate 杜絕 zombie 事後覆寫)
   - `updateStatusIfIn(id, ["queued","compiling","running"], "system_error")`(guard 保證 race-safe)
4. log kill 筆數

刻意不做:新 index(非終態筆數極少)、Temporal Schedule API(cron string 就夠)。

### 3. 次數返還

`countForUserAssessmentProblemSince` 的 where 加 `status: { not: "system_error" }`。學生端剩餘次數顯示若走別條 query 一併同步。

### 4. Admin UI

`/admin/rejudges` 上方設定卡:標題「判題逾時保護」+ 說明、number input(分鐘,顯示現值或預設 30)、form action(`consumeFormRateLimit` + 慣例驗證)、留頁成功回饋。

不顯示 sweeper 狀態或 kill 歷史(log 已進 Cloud Logging)。

## 邊界情況

- **Rejudge 中卡死**:`SubmissionRejudgeLog` 留下未 finalize 紀錄(只有 old*)——接受,代表該次 rejudge 未完成,可再重判。
- **考試/比賽中被 kill**:`system_error` 不觸發計分,等同從未完成判題;學生可立即重交。

## 測試計畫

1. Integration:次數計算排除 `system_error`(塞 1 筆 system_error + 1 筆正常 → count = 1)
2. Integration:sweep 把超齡 `queued` 標成 `system_error`;已終態的不動
3. Unit:設定 Zod 下限/上限拒絕、預設 fallback
4. Bundle fitness test 抓 workflow/activity 漏註冊
5. 全套 typecheck / lint / unit / integration 綠

## 驗收標準

- 手動把一筆 submission 改成超齡 `queued`,一分鐘內被標 `system_error`,剩餘次數 +1 回來
- Admin 改門檻後,下一輪 sweep 立即用新值
