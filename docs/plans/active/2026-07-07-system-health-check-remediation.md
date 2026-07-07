# 全系統健康檢查與改善計劃

2026-07-07。針對「正式上線前」的五面向全面掃描：架構、程式品質、資安、易用性、高可用。
方法：12 個 finder 分工掃描 → 每個發現走「預設駁回、讀真實程式碼才確認」的對抗式驗證（63 agent、零錯誤）。
原始發現 49 條全數通過驗證（1 medium 被駁回）；三個 ship-blocker 已人工複核比對程式碼。

本檔是**改善計劃**，不是稽核紀錄。依「上線風險」分 P0–P3，並明列**不建議動**的部分。
連結活文件而非重述：[RELIABILITY](../../operations/RELIABILITY.md)、[SECURITY](../../operations/SECURITY.md)、[ARCHITECTURE](../../architecture/ARCHITECTURE.md)、[backup-restore](../../runbooks/backup-restore.md)、[DEPLOYMENT](../../operations/DEPLOYMENT.md)。

---

## 實作結果（2026-07-08，分支 `fix/system-health-remediation-2026-07-07`）

9 個平行 agent（互斥檔案叢集）+ 整合驗證完成。**驗證全綠**：unit 1792、typecheck 18/18（web svelte-check 0 error 0 warning）、typecheck:tests、lint、integration 308（1 個 Dolos 冷啟動 flake，隔離重跑綠）、helm lint + template 渲染乾淨（備份 flag 關閉時無 dangling secret ref）。

**已落地**：P0-2 測資洩漏（`sanitizeStudentResult` + 補 `virtual-contest` 同源洩漏 + 測試）、P0-3 K8s 判題分波（保留 per-case memory.peak + 測試）、P1 sweeper describe guard / payload 瘦身 / MinIO 鏡像 + 監控告警（config-ready）/ 靜默失敗止血 / Publish 提示可見 / 判題狀態 poll / api-token 雙語、P2 `advanced-package` 抽 `@nojv/sandbox-docker`（安全參數單一來源）/ 草稿刪除 domain guard / cookieCache / cooldown 去重 / points 快照、P3 死碼清除 + 註解 lint gate（warn 模式）+ facade 收斂 + 多項 a11y/i18n/docs。i18n 達成 en/zh-TW 完全 parity（各 1935 key）。

**額外（使用者追加）**：清掉 svelte-check warning（two-factor `untrack`）；`as`→`safeParse` 反序列化硬化——storage `getVerdictDetail` 改回傳 `unknown` 由 app 層 `submissionResultSchema.safeParse`（A1）、互動判題把**學生可控 stderr** 從 `as InteractiveRunReport` 改成 core 具名 schema + safeParse（B1，資安相關）、compile 輸出 `parseCompileOutput`（B2）。

**⚠️ 意外發現並修復的部署地雷（deployment-critical）**：main 的 lockfile 已把整個 Temporal stack 浮動到 `@temporalio/* 1.19.0` + `protobufjs 8.6.6`，這個組合 **module load 就 crash**（`root must be an instance of a protobufjs Root`）。main 只因本地 node_modules 停在舊的 1.18.1/8.6.4 才沒爆，且 `ci:verify` 只跑 unit 不跑 integration 所以 CI 沒抓到——**任何 fresh install（CI integration、正式 Docker image build）都會產生會 crash 的 worker**。已於 `pnpm-workspace.yaml` overrides 把 Temporal 全 pin 回 1.18.1 + protobufjs pin 8.6.4（仍滿足既有 `>=7.6.1` 安全下限），還原 main 實測可用的組合。

**刻意 defer / 降級（非未做，是不值得硬做）**：
- P3 markdown CSS 注入 → **降級為 low-risk 待辦**：agent 的屬性 allowlist 破壞了既有安全測試且更弱（KaTeX 的 inline style 與 overlay 屬性天生重疊，只有「位置」能區分且該判斷可偽造）。正解是 two-pass 渲染（KaTeX→trusted HTML、strip 全部 user style、splice），屬 math pipeline 重構，對一個 LOW 的非 script CSS 注入不成比例。已還原原行為。
- P3 body-size chunked 繞道 → **降級為 low-risk 待辦**：agent 的「拒絕缺 content-length」破壞了刻意寬鬆的既有測試、且可能誤擋合法 client。正解是邊讀 stream 邊計 byte。已還原原行為。
- B3 admin dashboard 快取 safeParse → **skip**：型別是複雜巢狀推斷、需建模 Date→string 還原，自寫資料且已 try/catch 回 null、TTL 300s 自癒，硬寫大 schema 屬過度工程。
- UserStatus enum 去重 → **skip**：需 Prisma migration，超出 edit-only sweep，留待專門 PR。

**順帶修掉 5 個 PR #206 遺留的 pre-existing 測試失敗**（已驗證在乾淨 main 上也紅）：seed-test-db TABLES 補 `AdminAuditLog`、FRONTEND.md admin route map 同步（`/admin/system/users`→`/admin/users` 等）、app-layout-auth 測試補 `event.url`、two-factor 測試 mock 補 `listPasskeys`。

**待使用者處理（我無法自動完成）**：P0-1 Postgres 備份 + MinIO 鏡像的**實際啟用**需你建立 R2 憑證 secret（`ACCESS_KEY_ID`/`ACCESS_SECRET_KEY`）→ 翻 `backup.enabled: true` → 跑一次還原演練；步驟見 INFRA 章節與 RELIABILITY.md/backup-restore.md。node fs 告警的 datasource 需指向 in-cluster Prometheus 或 remote_write。rejudge cancel/progress ownership authz（需 Temporal memo，LOW，現由不可猜 UUID 緩解）與 publish-via-update 竄改（需 schema strip + load 同動）留作 follow-up。

---

## 總體結論

**這是一個成熟、右尺寸（right-sized）的系統，不需要重寫。** 五面向裡有四個本質健康，真正阻擋上線的是**資料安全**這一塊——不是設計缺陷，是「文件宣稱有備份、實際部署把備份關掉」的落差。

| 面向     | 現況評分                      | 一句話                                                                                                                                                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架構     | **A**                         | 分層正確、無循環依賴、`@nojv/application` 是真服務層不是 passthrough；沒有「更好的架構」值得付遷移成本（見下方「不建議動」）。                                                              |
| 程式品質 | **A-**                        | 全 repo 零 `any`、零 ts-ignore、命名清晰、Zod 守邊界；唯一集中債務是 `advanced-package.ts`（1400 行 god file + 與 worker 重複 ~350 行 sandbox 程式碼）。                                    |
| 資安     | **A-**                        | 授權層成熟（effective role gate 到位）、sandbox 硬化扎實（seccomp footgun 已解）、注入面乾淨。唯一 High 是**隱藏測資 input 經 `caseResults[].stdout` 洩漏給學生**。                         |
| 易用性   | **B+**                        | 雙語、a11y 基礎、設計系統都在；缺的是**長操作的即時回饋**（判題/導覽 pending 無指示）、**靜默失敗**（多處 raw fetch 無錯誤路徑）、**防呆提示不可見**（禁用按鈕的說明 tooltip 永遠不顯示）。 |
| 高可用   | **C（上線前）→ A（修完 P0）** | 判題隔離與 fail-closed 都對，但**正式 Postgres 零備份、MinIO（唯一一份學生原始碼）零備份、K8s 判題 >8 測資 100% 失敗**。這三項是上線前的硬阻擋。                                            |

**上線 gate：P0 三項未完成前不建議對外開放。** 其餘為上線後迭代。

---

## P0 — 正式上線前必修（ship-blocker）

### P0-1 · 正式 Postgres 零備份 〔CRITICAL〕

`infra/charts/nojv/values-single-machine.yaml:17` → `backup.enabled: false`，`instances: 1`（無備援）。
CD（`deploy.yml:127`）每次 upgrade 都套這份 values，所以就算手動開也會被下次部署還原。**已於正式叢集 SSH 實地確認**：`nojv-pg` 無 `spec.backup`、無 `ScheduledBackup`/`Backup`、四個 PVC 全是單機 `local-path`、無 host cron。
同一 `nojv-pg` 還跑 Temporal 的 `temporal`/`temporal_visibility`，workflow state 同命運。
`RELIABILITY.md:39` 卻宣稱「backed up by a ScheduledBackup (barman-cloud … PITR)」——**文件與部署直接矛盾**。

- **影響**：單機一次磁碟/節點損毀、誤 `DROP`、壞 migration，永久毀掉全部 user/problem/submission/course/exam/contest + 所有 Temporal state。RPO = ∞，restore runbook 不可執行。7/4 的 disk-full 事故距離這個結局只差一步（磁碟當時是塞滿而非損毀）。
- **修法**：建 barman S3 憑證 secret（用 runbook 已示範的 Cloudflare R2）→ `values-single-machine.yaml` 設 `postgres.cnpg.backup.enabled=true` + `destinationPath`/`endpointURL`/`s3CredentialsSecret`，讓 CD 把備份「鎖成開」。用 `kubectl cnpg status nojv-pg` 確認 base backup 完成 + WAL archiving current，**實跑一次 runbook 的 recovery drill**。另外把 `nojv-runtime-secrets`（`BETTER_AUTH_SECRET` 等）留一份離機備份——現在整機掛掉這些也一起沒了。
- 工作量：small（設定＋一次演練）。

### P0-2 · 隱藏測資 input 洩漏給學生 〔HIGH / 資安〕

`scoring.ts:82-92` `mapResult()` 對**每一個**測資（含隱藏）都塞 `stdout: truncate(t.stdout, MAX_CASE_STDOUT_BYTES)`（1MB/case）。`stripStaffFeedback()`（`scoring.ts:271-292`）只刪 `staffFeedback`，`stdout`/`stderr` 原封不動。學生 poll `GET /api/submissions/[id]`（owner 授權通過）就拿到自己提交的 `caseResults[].stdout`；exam 題目視圖（`problem-view.ts:122-128`）走同一條 strip-only 路徑。
UI 只渲染 `subtaskResults`（`buildSubtaskResults` 已**不含** stdout），所以畫面看不到，但 raw API JSON 有。

- **攻擊**：學生提交 `import sys; sys.stdout.write(sys.stdin.read())`，拿 WA，但每個隱藏測資的完整 input（≤1MB）落在 `caseResults[].stdout`，DevTools Network 或 3 行 fetch 就能還原整套隱藏測資 input。**考試/競賽進行中即可用**，破壞隱藏測資機密性（expected output 不外洩，僅 input）。
- 這**不是**刻意設計：`docs/plans/completed/2026-05-27-submission-unification-design.md:181` 把「strip stdout from graded flat caseResults」列為 deferred，schema 註解也寫 stdout 應「omitted on graded subtask cases」——是已知但沒關掉的技術債。
- **修法**：對非 staff 檢視者，比照 `staffFeedback` 一起把 graded（非 sampleOnly）`caseResults` 的 `stdout`/`stderr` 刪掉。最小改動：擴充 `stripStaffFeedback`（或加一個 sibling）在所有學生可讀路徑（poll endpoint、`getSubmissionDetail` 非 owner-staff 分支、exam problem-view、`/api/submissions/[id]`）刪 `c.stdout`/`c.stderr`。或在 `mapResult` 對 graded run 直接不塞 stdout（比照 subtaskResults），只 sampleOnly 才帶。
- 工作量：small。**加一個 integration test：非 staff 讀 graded submission 的 JSON 不含隱藏 case stdout。**

### P0-3 · K8s 判題 >8 測資 100% 失敗 〔HIGH / 高可用〕

`k8s-job-manifests.ts:156-169` 把每個測資 index 都 map 成一個 sibling app container，各自帶 `resources.requests`（chart wire `cpu 500m` / `mem 256Mi`）。`runPerCasePod` 不做 chunking（全部測資一次進 pod）。K8s pod 有效 request = 各 container 加總 → N 個測資 = `N×500m` CPU。正式 sandbox namespace `ResourceQuota` = `requests.cpu 4`。

- **影響**：任何 **>8 測資**的 standard 題（exact/checker），pod 請求 >4 CPU，quota 永遠 admit 不了 → `SandboxBackpressureError` → 3 次 retry 全失敗 → 逾時 sweep 標 `system_error`，**100% 確定失敗**。`RELIABILITY.md` 自己的 SLO class 就寫「≤20 測資」。就算在額度內也重創吞吐：4 測資題（2 CPU/pod）全平台只能 2 並發、8 測資題直接吃滿整個 quota。GKE 更早壞：sandbox pool 是 `e2-standard-4`（4 vCPU），~8 測資 pod 就超過 node allocatable，autoscaler 只加節點數不加節點大小 → 永遠 Unschedulable。
- **修法**：把 pod request 與測資數解耦。三選一（建議①）：
  1. **單 runner container 內序列跑各 case**——Docker backend 已經這樣做（`standard-mode-executor.ts:246-266`），把 K8s 對齊即可；
  2. 把 `caseIndices` 依 quota 切成 K 個一波（K≈4）；
  3. 保留平行 container 但每個設極小 request（如 100m）＋ pod 層固定上界。
     另加**出題/發布時的檢查**：題目測資數要能塞進部署的 sandbox quota。
- 工作量：medium。這是判題正確性核心，需 integration 驗多測資題在 K8s backend 實跑 AC。

---

## P1 — 上線後首週（資料安全補完 + 可觀測性 + 止血）

### 資料安全（承 P0）

- **MinIO 零備份**〔HIGH〕`packages/storage/src/keys.ts` 顯示學生原始碼（`submissions/<id>/sources/`）是**唯一一份**、Postgres 無 source 欄位。MinIO 是單 replica、單 `local-path` RWO PVC、無版本/複寫/備份。丟失 → 原始碼、code review、既有 PairFlag 抄襲證據永久消失，且事後 rejudge 會把 verdict 轉 `system_error`（`judge.ts:171-180`）。`backup-restore.md:38-39,457-459` 卻寫「re-uploadable author assets / no submission data is at risk」——PR #73/#74 搬 S3 後就過時。（部分緩解：`Submission.verdictSummary` 存在 Postgres，成績/記分板不 rejudge 就還在。）
  - **修**：MinIO bucket 加離機鏡像（`mc mirror --overwrite` CronJob 打到 barman 同一個 R2），或乾脆正式 object storage 直接改用 R2/GCS（`@nojv/storage` 本就 S3-compatible）。同步修 `backup-restore.md`。
- **磁碟/PVC/DB 健康無監控告警**〔MEDIUM〕`prometheus.yaml` 無 node-exporter/cadvisor scrape，`slo-alerts.json` 無磁碟/PG 規則——7/4 事故的**偵測缺口至今沒補**。加 node-exporter job + 兩條規則（node fs >80%、`nojv-pg`/cnpg operator pod not-ready），P0-1 後再加 backup-freshness 告警。

### 判題韌性

- **逾時 sweeper 誤殺健康判題**〔MEDIUM〕`sweep.ts:32-47` 純看 DB `updatedAt`，考試爆量時佇列深度×判題時間一超過 10 分鐘，**還在跑的合法提交被整批標 `system_error`**。修：terminate 前先 `describe()` `judge-<id>` workflow，RUNNING 且有近期 heartbeat 就跳過（只收 NOT_FOUND/closed-but-stuck）。
- **測資 blob 兩次穿越 Temporal payload**〔MEDIUM〕`queries.ts:423-448` 把完整測資塞進 workflow input，authoring 允許 16MB/blob 但 payload 層 ~1-2MB 就 silently 失敗（三個互相矛盾的上限）。修：`fetchJudgeContext` 只回 metadata + S3 key，`executeSandbox` 直接讀 blob（它本就連 S3+DB）；workflow input 拿掉 sourceCode/sourceFiles。

### 易用性止血（靜默失敗會讓老師以為系統壞了）

- **多處 raw form fetch 靜默失敗**〔MEDIUM〕改角色、移除成員、建/刪題、記分板解凍（`courses/[courseId]/members/+page.svelte:60-80`、`ProblemTabs.svelte:39-53,76-88`、`scoreboard/+page.svelte:115-126`）。失敗時畫面無反應或「UI 撒謊」（select 顯示新角色但 server 沒改）。修：每個加 `!res.ok`/`failure` 錯誤路徑 → `toasts.error` + 還原樂觀值（toast store 已存在）。
- **禁用 Publish 按鈕的說明 tooltip 永遠不顯示**〔MEDIUM〕`problems/[id]/edit/+page.svelte:180-193`：`disabled` + `pointer-events-none` 導致「為什麼 Publish 是灰的」的唯一解釋物理上不會 render——老師第一次出題最常見的卡點。修：把要求改成按鈕旁的可見 inline 文字（「需先上傳至少一組測資才能發布」），或把 disabled button 包一層 span 帶 title。
- **判題中狀態凍結不更新**〔LOW→體感 High〕`submissions/[submissionId]/+page.svelte` 顯示「Judging…」永不更新，學生學會狂刷。修：`isPending` 時用既有 backoff helper poll `/api/submissions/{id}` 或重用 `watchSubmissionVerdict` SSE，完成時 invalidate。
- **API tokens 帳號頁全英文**〔MEDIUM〕`account/api-tokens/+page.svelte` 整頁繞過 paraglide、硬寫 en 日期、英文錯誤 banner，對主受眾（台灣大學課程）破壞雙語一致性。修：抽 `apiTokens_*` message key、改用 `formatDateTime`、補 `zh-TW.json` 的 `userMenu_apiTokens`。

---

## P2 — 品質與韌性強化（上線後穩定期）

### 集中技術債：`advanced-package.ts`（唯一真正的品質熱點）

- **重複實作 worker 的 docker sandbox 層**〔MEDIUM〕`advanced-package.ts:294-948` 把 `docker-process`/`docker-network`/`service-container`/`egress-proxy` 的 ~350 行（含**安全相關 container args**）複製一份在另一個 package。判題路徑事後硬化（加 seccomp/收緊 tmpfs）不會套到這條 sample-validation 路徑——**安全參數會漂移**。修：抽共用 docker helper 成一個模組（小 `@nojv/sandbox-docker` 或把 sample validation 移進 worker）。
- 同檔連帶：bounded zip reader 複製 3 份（zip-bomb 防護）、`runDocker`/`runDockerText` 兩份相同、1400 行 god file 跨五個關注點。抽共用後順勢拆檔。

### 判題延遲與擴容（誠實化）

- **單一 4-slot judge queue 混跑 10 分鐘 sandbox 與 sub-second commit**〔LOW〕已完成判題的 verdict commit + SSE publish 卡在 pending sandbox 後面，直接拉高 judge-latency SLO 指標。修：把輕量 activity（`updateContestScores`/`publishVerdict` 等）routed 到 `PLATFORM_TASK_QUEUE`（已註冊在 platform-bundle）。
- **自動擴容是「chart 有、實際沒有」**〔LOW〕正式環境容量全靜態（1 web、1 judge worker×4、sandbox 4 CPU/10 pod 於單機），KEDA query 是佔位。DEPLOYMENT.md 卻讓 operator 以為爆量會自動吸收。修：文件寫清單機真實天花板（依測資數的最大並發提交數）、修「2 replicas」宣稱、給一條能動的 KEDA query。
- **每個已登入請求都打一次 Postgres session lookup**〔LOW〕better-auth `cookieCache` 沒開，考試開始數百頁載入 + 0.5-5s verdict polling 每次都經 10-connection pool。修：開 `session.cookieCache`（maxAge 30-60s）；權衡是停用帳號/撤銷 session 延遲 ≤TTL。
- **platform worker 忽略 `WORKER_CONCURRENCY`**（硬寫 10）、**stale sweeper 之外的小 config no-op**：一併修或文件標明固定值。

### 資料模型防呆（Cascade 靠 route 檢查，可被繞過）

- **草稿限定刪除只在 route 把關、published→draft 無守衛**〔MEDIUM〕`problem/mutations.ts` 的 draft-only 檢查在 route handler，不在 `deleteProblemRecord` 本身；`Submission.problem` 是 `Cascade`。作者可用竄改的 form post 把已發布題退回草稿再刪 → 連鎖清掉所有人對該題的 submission/rejudge log/feedback/override。修：把 draft-only 檢查下沉進 `deleteProblemRecord`，並在 `updateProblemRecord` 拒絕 published→draft（從 draft-save schema 拿掉 `status`，publish 維持專用 action）。
- **hard-delete user 連鎖毀掉已評分 exam/contest 提交**〔LOW〕`countDeletionBlockers` 只鏡射 Restrict FK，沒算 submission/participation。修：把 submission/participation 計入 blocker，有評分歷史的走既有 soft-anonymize 路徑。
- **link-table `points` 快照會與 live 測資權重漂移**〔LOW〕point_sum 模式用它當 full-solve 門檻，改權重後首 AC/first-blood 判定會錯。修：full-solve 改看 `status === "accepted"`（problem-count 已這樣），或權重變更時刷新快照。

---

## P3 — 打磨（低風險、隨手清）

**資安（皆 LOW、非可直接利用）**

- 標準題檢視 loader 讀 stored platformRole（`problems/[id]/+page.server.ts:56-62`），繞過 admin de-elevation——僅影響 admin 帳號看 private 題。改用已算好的 effective actor。
- rejudge cancel/progress endpoint 無 ownership 授權（`api/rejudges/...`）——實務上 workflow id 帶 `randomUUID()` 不可猜，但應補 `assertBatchRejudgeAccess`。
- markdown style 屬性靠可偽造的 KaTeX class name 放行 → inline CSS 注入（非 script XSS）。改：不靠 author 可控 class 放行 style。
- Docker backend compile artifact host mount 無大小上限（host 磁碟耗盡；僅 dev，prod 走 K8s）。改 size-limited tmpfs。
- clarification-subscription SSE 無上限、無限流 → DB 放大 DoS。改：`parseClarificationSubs` 上限 20-30 或套 Redis 限流。
- per-route body-size 檢查信任 content-length header，chunked 可繞到 64MB adapter 上限。安全相關 route 改邊讀邊數 bytes。

**易用性/文件/i18n（皆 LOW）**

- 全域無導覽 pending 指示（`+layout.svelte`）——重頁面點了無反應。加頂部細進度條（`navigating`，>150ms 才顯示）。
- 少數 zh-TW 未翻值 + 硬寫英文 aria-label/alt（主導覽、2FA QR）；**無 CI gate 抓漏翻**。補翻 + 加 en/zh-TW key-set diff 的 CI 步驟。
- `/guides/advanced-mode` 英文 only（從中文編輯器進入）；problem-create menu（`role="menu"`）無法 Escape/click-outside 關閉（比照 UserMenu）。
- getting-started 沒寫 seeded 帳號密碼登入在 `/admin-signin`；FRONTEND.md:174 的「known drift」已不存在——刪。

**程式品質清理（皆 LOW、可直接刪 ~400 行死碼）**

- 5 個零 importer 的 Svelte 元件（334 行）、`getLogger`/`isSSEConnected`/`fmtWeekday` + 14 個 orphan i18n key。
- `checkExamSubmitCooldown` 與 `checkSubmitCooldown` 是同函式換 FK（30 行併一）、otel bootstrap web/worker 逐字重複。
- ~34 條在 PR #77 全清後**重新累積**的說明註解（多來自近期 admin/account 改動）——違反零註解規則，**建議加 lint gate 防再長回來**。
- `sandbox-schema.ts:41` double-cast 對 `testcaseResults` 說了型別謊（optional 卻宣稱必存）；scoreboard/admin cache 用裸 `as` 反序列化——deploy 改 shape 時回傳過時 blob。改 `safeParse` fallback rebuild。
- ESLint layer guard 的 per-file 例外是整條 rule `off` 而非只放行該 package——未來誤 import `@nojv/db`/`@nojv/temporal` 會靜默過 CI。改成只 narrow 掉該 package 的 pattern。

---

## 不建議動（誠實結論：架構已右尺寸）

使用者問「有沒有更好的架構、不考慮成本」。查證後答案是**沒有值得換的**：

- 分層（UI→Presentation→Service→Persistence）正確且**確實有被強制**：`packages/application/src` 內零 `@nojv/temporal` import、`packages/db/src` 內零 redis/storage import、web 只在 `auth.server.ts` 碰 `@nojv/db`、madge 確認 127 個 application module 零循環、ESLint layer guard 真的編碼了 allow-list。
- `@nojv/application` 是**真服務層**：`createQueuedSubmissionRecord` 承載授權、invariant、advisory-lock cooldown、交易式建立、staged-storage 補償；scoring/matrix 抽成共用 core + 薄 per-context adapter，不是複製貼上。
- `DomainOrchestrationAdapter` 用一個 10-method interface + 兩個 4 行 wiring 檔就把 `@temporalio/*` 擋在 application 之外——這正是 `@temporalio/common 1.19` module-load crash **沒有**波及 application 的原因。它是 3 個測試套用的 test seam，成本極低。
- 換 microservices / CQRS-event-sourcing / hexagonal-everywhere / 把 worker 併進 web / 拔掉 repository 層改裸 Prisma——每個都是增加維運負擔或拔掉已回本的 seam。
- 唯一誠實的架構評語（已列在 P2/P3）：repository 層實質是「curated query catalog」而非文件宣稱的硬抽象邊界——這是**文件用詞**要對齊，不是要新建抽象。

**sandbox 隔離**同樣不需要重做：cap-drop ALL、no-new-privileges、read-only rootfs、non-root uid、per-problem mem/cpu/pids、no-swap、network isolation（fail-closed 啟動探針）、答案檔隔離、無 docker socket/privileged/hostPath——全部比對真實 spawn args 確認到位，seccomp footgun 已解。

---

## 里程碑排序

1. **上線 gate（P0）**：P0-1 備份 → P0-2 測資洩漏 → P0-3 測資上限。三者獨立、可並行三個 PR。**全綠才對外開放。**
2. **首週（P1）**：MinIO 鏡像 + 監控告警（補 7/4 偵測缺口）→ sweeper 誤殺 + payload 瘦身 → 靜默失敗/tooltip/判題狀態/api-token i18n 這批易用性止血。
3. **穩定期（P2）**：`advanced-package.ts` 抽共用（安全參數統一）→ 判題延遲 queue 分流 + cookieCache → 資料模型防呆（Cascade 下沉）。
4. **打磨（P3）**：死碼清除 + 註解 lint gate + i18n CI gate + 一批 LOW 資安/a11y/文件。

## 風險與備註

- **P0-1 演練不可省**：只設 `enabled=true` 不算完成，必須實跑一次 recovery drill 證明可還原（含 Temporal DB）。
- **P0-3 三選一建議①**（對齊 Docker backend 的序列單容器）改動面最小、與現有程式一致；②③ 要多管 quota 數學。
- 本 repo 歷史稽核假陽性率 ~50%，故每條都經對抗式驗證；仍建議動手前重讀對應程式（點位可能隨後續 PR 漂移）。
- 三個 ship-blocker 都**不在**已知 [non-goals](../../../.claude/projects/-Users-takala-code-NOJV/memory/project_explicit_non_goals.md) 內，且與活文件宣稱矛盾（backup、hidden-test 機密、SLO 測資 class），屬「文件 vs 實作漂移」而非刻意設計。
- 修完後同步更新 [QUALITY_SCORE](../../operations/QUALITY_SCORE.md) 的 Reliability/Security 列與 Outstanding Drift。
