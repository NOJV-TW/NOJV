# 全 Codebase 稽核修復計劃(2026-06-12)

> **For Claude:** 實作時用 `superpowers:executing-plans` 逐 task 進行,每個 task 先寫/改測試再改實作(TDD),頻繁 commit。
>
> **紀律警告(本次稽核的血淚教訓):** 這份計劃的 finding 來自 12 維度平行稽核 + 對抗式雙鏡頭驗證。過程中**同一個 P0 在第二次重跑被誤判降級成 P3**(agent 買單了程式碼註解的安全論證)。因此:**動手修每一項前先親自 Read 該檔追呼叫鏈確認問題仍在**,severity 以本計劃裁決後的標註為準,不要再被註解或文件說服。此 repo 歷史稽核假陽性率約 53%。

**Goal:** 修復 2026-06-12 全 codebase 稽核(`docs` 無此報告,結論直接寫入本計劃)發現的全部缺陷——使用者要求**全部修復**。涵蓋安全/正確性 P0/P1、判題層測試債、文件誠實度、效能熱路徑、死契約清理、組態守衛。

**Context:** 承接 [`2026-06-11-post-audit-next-phase.md`](../completed/2026-06-11-post-audit-next-phase.md)(已完成)。上一輪稽核聚焦結構性風險;本輪是全 12 維度深掃,規模更大、面向更廣。

**Tech Stack:** SvelteKit + better-auth + Temporal(自架)+ Prisma 7 + Redis + S3 + Vitest + Playwright。

**Living docs 對照:** 修文件項時對齊 [ARCHITECTURE](../../architecture/ARCHITECTURE.md) / [REDIS](../../architecture/REDIS.md) / [DATABASE](../../architecture/DATABASE.md) / [JUDGE_PIPELINE](../../architecture/JUDGE_PIPELINE.md) / [SECURITY](../../operations/SECURITY.md) / [THREAT_MODEL](../../operations/THREAT_MODEL.md) / [QUALITY_SCORE](../../operations/QUALITY_SCORE.md)。

---

## 執行進度(branch `fix/full-audit-remediation-2026-06-12`,1344 unit + 全 lint 綠)

**✅ 完成**

- **Phase 0(全部)** — 0.1 rejudge-cancel 前綴守衛(P0)、0.2 exam confinement、0.3 onDelete 對稱化+migration、0.4 docker `--memory-swap`、0.5 docker.sock group_add。
- **Phase 1(全部)** — 1.1 隔離測試進 nightly、1.2 docker-arg golden、1.3 TLE 改 cgroup CPU-time、1.4 workflow versioning doc、1.5 coverage 納 worker/sandbox、1.6 e2e 終態斷言、1.7 getTemporalClient single-flight(snapshotForRejudge 冪等 + memory poller 列遞延,見下)。
- **Phase 2(全部)** — 2.1 QUALITY_SCORE 誠實帳本、2.2 scoreboard 四文件統一、2.3 THREAT_MODEL phantom 清除、2.4 a–i(ARCHITECTURE / DATABASE prose / SECURITY advisory / incident-recovery / JUDGE_PIPELINE / gke+gcp README)。
- **Phase 3(部分)** — 3.1 scoreboard chart 重用、3.3a problem loader 並行化、3.4 plagiarism omit、3.5 索引 migration + point-sum 分桶。
- **Phase 4(部分)** — 4.1a adminOverrideSignal 死契約移除(方案 A,使用者確認 prod 未對外、無 in-flight 比賽,故直接乾淨移除;behavior 等價)、4.1c sse.ts 三個死 toast handler + i18n key、4.1e notification dedupeKey。
- **Phase 5(大部分)** — 5.1 temporal/sandbox-runner 補 lint(修 21 既存違規,含一個 `return await` 真 bug 傾向)+ lint-coverage fitness test、5.2 workflow 名稱契約(確認既有 `workflow-registration.test.ts` 已覆蓋)、5.5 exam-context cache null 短 TTL、5.7 web prod env fail-fast + seed Redis 死碼 + pubsub 孤兒註解、5.8 SSE reconnect onopen 重置、5.10 verdict sanitizer fail-closed + avatar magic-byte。

**⏸️ 遞延(有具體理由,非遺漏)**

- **1.7 snapshotForRejudge 冪等 / memory poller 精度** — 需 schema migration + 5 處改動換 P3 orphan-log;不成比例,遞延。
- **未來 workflow 編排改動** — A 已乾淨移除 adminOverride,但下次再改 `workflows/` 的 command 序列且有 in-flight 比賽時,仍需依 DEPLOYMENT「Workflow Versioning」紀律(patched / 挑無比賽時部署 / replay test)。長期保險可加 Temporal replay test(需歷史 fixture)。

**🔲 待做(P2/P3 polish,多檔/前端/重構)**

- **3.2 listProblemSubmissions S3 扇出** — 需前端 master-detail 改 lazy-load 完整 verdict(列表只需 verdict,可改用 `verdictSummary`);**需可視驗證**。
- **3.3b** problems 列表 9 查詢 / computeStatusCounts 4 子查詢合併。
- **4.1b/d** 死契約(publishAssessmentDeadline 死 activity 鏈=schema/bundle/openapi 多檔、scoreboard Friends/Around 死 UI=前端視覺)。
- **4.2** context 概念 6 份 → core schema、**4.3** form action 錯誤 wrapper、**4.4** sandbox executor source-file 去重、**4.5** EditorCore/MonacoScriptEditor 等去重。
- **5.3** CHECK 重放進測試 DB(test-harness)、**5.4** Participation status enum(migration)、**5.6** rate limiter offline-queue(需獨立連線)、**5.9** CD backup/SLO/rollback(infra)、**5.10 殘餘**(BODY_SIZE_LIMIT、markdown ADD_ATTR 需 KaTeX 視覺驗證、editorial early-return、heartbeat 孤兒端點、createOverride 驗證、bundle 守衛)、**5.11** 前端 a11y/i18n 批次(視覺)。

---

## 不做清單(查證後判定刻意/不該做,別重啟)

> 對抗式驗證**推翻或下修**的 finding,列此避免下一輪重提。

- **「每筆判題 ×N 觀眾 = 3N 放大」**(performance 原 P1)— 對抗式驗證(False/high ×2)推翻:`publishScoreboardUpdate` 有 `SCOREBOARD_UPDATE_THROTTLE_SECONDS=10` 節流,非每筆判題都 publish。真實問題是「scoreboard 無快取全量重算」(已收進 Phase 3 T3.1),「per-judge 3N」框架不成立。
- **「三套互相衝突的生產部署敘事」**(infra 原 P1)— 推翻(False ×2):`DEPLOYMENT.md` 明確只有兩條 canonical 路徑(GCP via `deploy.sh`、自架 via docker-compose),各自內部一致。真實殘留只有 `deploy.sh` 未顯式設 `EXECUTION_BACKEND`(已收進 Phase 5 T5.7 的小項)。
- **「kubectl apply -k 漏 sandbox ResourceQuota」**(infra 原 P1)— 下修(split vote):兩步 apply 是**刻意設計且 4 處文件記載**,非遺漏。真實問題只是 `gke/README.md:64-66` 一句「single apply」與正式 flow 矛盾 → 降為 Phase 2 文件一致性小項。
- **`@nojv/db` 匯出 Prisma namespace**(arch repository-pattern 切面)— better-auth adapter 框架要求,已拍板保留(承接上輪 7.2)。本輪 arch 的「repository 契約邊界」finding 只取「文件說過頭」那一半(Phase 2 修文件),不動 repo 簽名。
- **VirtualContest / Submission FK 多型化** — 上輪已決「無限期遞延」(超型已保留真實 FK),不重啟。

---

## Phase 0 — 安全 / 正確性(P0/P1,最優先,**我已親自複驗**)

### Task 0.1 — 🔴 P0:rejudge cancel/progress 無前綴與所有權檢查

**問題(已複驗):** `apps/web/src/routes/api/rejudges/[workflowId]/cancel/+server.ts:12-18` 只有 `requireApiAuth`,把 URL `workflowId` 直接餵給 `cancelRejudge` → `packages/temporal/src/dispatch.ts:141-145` 的 `getHandle(workflowId).cancel()`,**無前綴檢查**。`rejudge-{suffix}-{randomUUID()}` 雖不可猜,但其餘 workflow ID 全可預測:`submission-pending-sweeper`(常數)、`contest-lifecycle-{contestId}`、`exam-auto-close-{examId}`、`judge-{submissionId}`、`plagiarism-{type}-{id}`。任何已驗證學生可取消全平台 sweeper cron / 任一比賽 lifecycle / 任一考試 auto-close / 別人或自己的判題(卡 running→reaper 標 system_error→返還每日次數=次數上限繞過)。程式碼註解「workflowId 是 capability token…embeds a millisecond timestamp」是**過時且錯誤**(實為 randomUUID)。

**修法:**

1. 在 **domain 層**(非 route)`packages/domain/src/submission/` 加守衛:`cancelRejudge`/`queryRejudgeProgress` 先斷言 `workflowId.startsWith("rejudge-")`,否則丟 `ForbiddenError`。
2. 進一步:持久化發起者(`SubmissionRejudgeLog` 已有 `rejudgedByUserId`),cancel 時要求 actor = 發起者 ∨ 該 context staff ∨ admin。最小版先做前綴檢查 + staff 守衛。
3. 修正 `cancel/+server.ts:9-11` 與 GET route 的誤導註解。
4. **Fitness test:** `tests/integration/http/rejudge-cancel.test.ts` — 學生對 `contest-lifecycle-x` / `submission-pending-sweeper` POST cancel 必須 403;對自己發起的 `rejudge-...` 成功。

- **verify:** integration 測試紅→綠;`cancelRejudge("submission-pending-sweeper")` 被擋。

### Task 0.2 — 🔴 P1:考試 confinement 不及於判題 API

**問題(已複驗):** `packages/domain/src/submission/mutations.ts:198-315` 的提交建立流程,exam 路徑的 `assertActiveExamSubmissionAllowed`(:54-79)只檢查「無外部 context / 未結束 / cooldown」,**無題目歸屬檢查**;:256 的 `assertProblemViewAccess` 對 public 題放行。對照 contest 路徑(:246-253 `contestProblemRepo.findLink`)與 assignment 路徑(:112-115 `assessmentProblemRepo.findLink`)都有,**exam 漏了**。鎖屏中的考生可對任意 public 題提交、取得完整 verdict,submission 還被標 examId(卻不進老師 exam matrix,難察覺)。

**修法:**

1. `assertActiveExamSubmissionAllowed` 內加 `examProblemRepo.withTx(tx).findLink(exam.id, problem.id)` 檢查;非考題(且非該考題的 sampleOnly)一律 `ForbiddenError("This problem is not part of the exam.")`。
2. **integration 測試:** active exam session 下對非考題 `POST /api/submissions` 必須 403;對考題正常。

- **verify:** 測試紅→綠;與 contest/assignment 路徑行為對稱。

### Task 0.3 — 🔴 P1:題目刪除 onDelete 不對稱 → 跨使用者資料毀滅

**問題(已複驗):** `ExamProblem.problem` 是 `onDelete: Restrict`(`contest.prisma:189`),但 `ContestProblem.problem`(:122)、`AssessmentProblem.problem`(`course.prisma:137`)、`Submission.problem`(`submission.prisma:83`)是 `Cascade`。app 層唯一守衛「只能刪 draft」可被作者 `published→draft`(`problem/mutations.ts:143` 允許改 status)繞過;`deleteProblemRecord`(:100-108)不檢查 context 連結。作者(email 已驗證學生可建題)可在比賽進行中刪題,Cascade 同時銷毀 ContestProblem 連結與全體參賽者 Submission,Participation 持久化 score 變幽靈;對 exam 因 Restrict 變未處理 P2003 → 500。

**修法(二擇一,建議 a + b 都做):**

1. **(a) Schema 對稱化:** `ContestProblem.problem`、`AssessmentProblem.problem` 改 `onDelete: Restrict` 對齊 ExamProblem。新增 migration。
2. **(b) Domain 守衛:** `deleteProblemRecord` 先查 contest/assessment/exam links(`anyWithContextForProblem`),有連結則 `ConflictError` friendly message(取代 Restrict 的裸 P2003→500)。
3. **(c) 限制回退:** `buildProblemUpdateData` 在題目有 context 連結時禁止 `published→draft`。
4. **測試:** 有 context 連結的題刪除被擋並回 friendly error;`published→draft` 在有連結時被拒。

- **verify:** migration `migrate diff` 乾淨;測試覆蓋三條路徑。

### Task 0.4 — 🔴 P1:Docker 沙箱 `--memory` 無 `--memory-swap` → MLE 誤判

**問題(已複驗,grep `--memory-swap` 全 worker 零命中):** `standard-mode-executor.ts:202`、`validator-executor.ts:68`、`interactive-executor.ts:66`、`advanced-mode-executor.ts:80` 都只下 `--memory ${memoryMb}m`。Docker 預設 `--memory-swap` = 2×`--memory`,在啟用 swap 的宿主(自架 docker-compose 生產、開發機)上,提交可用到 **2× 記憶體**才被 OOM-kill;`run-process.ts` 的 `SIGKILL→MLE` 不觸發,需精準記憶體上限的題誤判成 AC/TLE。K8s 因 kubelet 預設關 swap 而安全。

**修法:**

1. 四個 docker executor 的 arg 陣列在 `--memory` 後加 `--memory-swap` `${memoryMb}m`(= 關閉容器 swap,讓 MLE 與宿主 swap 設定無關)。
2. 與 Task 1.2 合併:抽 `buildDockerRunArgs()` 純函式後,golden 測試斷言含 `--memory-swap` = `--memory`。

- **verify:** golden arg 測試;nightly 實機判題對記憶體超限題目得到 MLE。

### Task 0.5 — 🔴 P1(條件性):docker-compose CD 路徑 worker EACCES 判題全壞

**問題(已驗證):** `worker.Dockerfile:50,88` 以 `appuser`(uid 1001,僅 nodejs group)`USER appuser`;`docker-compose.yml:193,215` 設 `EXECUTION_BACKEND: docker` 並 mount `/var/run/docker.sock`,無 `group_add`。host docker.sock 通常 `root:docker 0660`,appuser 不在 host docker group → `docker run` EACCES → 每筆提交 system_error。`deploy.yml` health check 只 `curl` 首頁,測不到。**條件:** 僅影響實際使用 docker-compose CD 路徑者(GCP/GKE 路徑用 k8s backend 不受影響)。

**修法:**

1. `docker-compose.yml` worker 服務加 `group_add` 對齊 host docker GID(或 Dockerfile 用 build arg `DOCKER_GID` 把 appuser 加進對應 gid)。
2. `deploy.yml` health 階段加端到端 smoke:送一題已知 AC 提交、輪詢 verdict,讓判題鏈真的被 CD 驗證(而非只看首頁 200)。

- **verify:** 自架路徑第一筆提交不再 EACCES;CD smoke 抓得到判題壞掉。

---

## Phase 1 — 判題層自動化護欄(本次稽核評分最低的一層)

> **系統性根因:** 「容器執行參數構造」這一層在架構上沒有契約守護,docker-arg / k8s-pod-spec / cgroup 語意全靠人腦記憶。MEMORY 已記兩次踩雷(seccomp footgun、mock 抓不到 docker-arg bug)。本 Phase 把它系統化。

### Task 1.1 — 🟠 P1:沙箱隔離對抗式測試在 CI 完全不跑

**問題(已驗證 True/True):** `tests/integration/judge/{testcase-exposure,checker-isolation,interactive-isolation}.test.ts`(含真實 exploit:讀 `/submission/testcases/*/expected.txt`)靠 `dockerImageAvailable()→ctx.skip`;PR CI 不 build image、nightly 只跑 `tests/unit/worker`。綠燈 CI 對「學生能否偷讀測資答案」零訊號。

**修法:**

1. `.github/workflows/nightly-sandbox.yml` 在既有 `pnpm sandbox:build` 後加 `pnpm vitest run tests/integration/judge`(image 已 build,不會 skip)。
2. `dockerImageAvailable()→skip` 在 `process.env.CI` 時改 **hard fail**(該跑卻 skip 不該被當通過)。

- **verify:** nightly 真的執行三個 exploit 測試;移除 image 時 CI fail loud。

### Task 1.2 — 🟠 P2:docker hardening flags 無 arg 比對測試

**問題:** `standard-mode-executor.ts:181-211` 構造 `--cap-drop ALL`/`no-new-privileges`/`--read-only`/`--network none`/`--pids-limit`/tmpfs 等;唯一驗證是 nightly YAML **另抄一份字串**。K8s 路徑有 `buildSandboxJobManifest` 完整斷言,docker 路徑沒有 → 漏改某 flag,unit/nightly 全綠。

**修法:**

1. 把 `runContainer` 的 arg 構造抽成純函式 `buildDockerRunArgs(config, ...)`(四個 executor 共用同一構造器)。
2. `tests/unit/worker/docker-run-args.test.ts` 斷言完整 hardening profile（含 Task 0.4 的 `--memory-swap`、`--network none`、`--cap-drop ALL`、`no-new-privileges`、`--read-only`、`--user 10001`、`--pids-limit`）。
3. nightly 隔離步驟改從同一函式取 flag(而非 YAML 硬抄)。

- **verify:** 改任一 flag 立即測試紅。

### Task 1.3 — 🟠 P2:TLE 用 wall-clock 而非 CPU time

**問題(critic):** `run-process.ts` 用 `performance.now()` 量 elapsedMs,TLE 判定與顯示時間全是牆鐘;`ulimit -t`(`utils.ts:119`)只設 CPU-second 硬殺底線。多容器並發/noisy-neighbor 下正確解可能因排程延遲被誤判 TLE,判題不可重現、不公平。

**修法(需設計決策,先 brainstorm):**

1. 評估改用 cgroup `cpuacct`/`cpu.stat` 的 CPU time 作為 TLE 判定與顯示,wall-clock 僅作 outer watchdog 上限。
2. 或文件化「本平台 TLE 採 wall-clock + 單核釘選(`--cpus`)」的取捨,並在 JUDGE_PIPELINE.md 明記其公平性限制與緩解(隔離 node pool、`--cpus 1`)。

- **verify:** 決策落地 + JUDGE_PIPELINE.md 記載;若改 CPU time,補並發競爭下不誤判 TLE 的測試。
- **注意:** 這是 online judge 核心方法論,動 verdict 邏輯前先寫設計 doc。

### Task 1.4 — 🟡 P2:Temporal workflow 零版本控制(patched/getVersion)

**問題(critic):** 6 個 workflow 全無 `patched`/`getVersion`。長壽 workflow(contest-lifecycle 跑整場比賽、exam-auto-close 跨整場考試)在改 workflow 程式碼重部署後,執行中的舊 workflow replay 撞 non-determinism error 卡死。自架 Temporal 的真實運維風險。

**修法:**

1. 在 RELIABILITY.md / DEPLOYMENT.md 記載「改 workflow 程式碼必須用 `patched()`/`getVersion()` 守護 + 部署前確認無 in-flight 舊版」的運維紀律。
2. 對既有長壽 workflow(contest-lifecycle、exam-auto-close)的下一次修改起導入 patch 守衛範式。
3. 評估 worker 部署策略:長壽 workflow 在版本切換時的 drain/排空步驟。

- **verify:** runbook 有可操作的 workflow 演進步驟;下次改 workflow 帶 patch 守衛。

### Task 1.5 — 🟡 P2:coverage threshold 排除 worker + sandbox-runner

**問題:** `vitest.config.ts:29-35` 的 coverage include 只有 `packages/domain` + `packages/core`,把 `apps/worker`(4140 行)+ `apps/sandbox-runner`(1398 行,含 docker/k8s arg 構造)排除。歷史高風險區(mocked sandbox 抓不到 docker-arg bug)無覆蓋率門檻。

**修法:** coverage include 納入 `apps/worker/src` + `apps/sandbox-runner/src`(可設務實門檻如 lines 70),或至少對 `services/*-executor.ts` 設 per-file 門檻。

- **verify:** coverage 報告涵蓋兩層;低於門檻 fail。

### Task 1.6 — 🟡 P2:e2e submission-lifecycle 把 queued/running 當成功終態

**問題:** `tests/e2e/submission-lifecycle.test.ts:397-407` 最終斷言把 `queued`/`running` 也列通過值,判題從未跑也綠;唯一 assert `accepted` 的 `editorials.test.ts:186` 被 `NOJV_E2E_RUN_JUDGE` 預設 skip。

**修法:** submission-lifecycle 判題步驟在本機/有 image 時 assert 真正終態(accepted/WA/...);否則 explicit `test.skip` 標「需 worker+image」(對齊 Task 2.1 編輯題解的做法),不留永遠綠卻沒驗的測試。

- **verify:** opt-in 後非終態是真 regression。

### Task 1.7 — 🟢 P3:判題 idempotency / 量測殘渣(批次)

| 項                                        | 檔                                | 修法                                            |
| ----------------------------------------- | --------------------------------- | ----------------------------------------------- |
| snapshotForRejudge 非冪等(重試插重複 log) | `submission/mutations.ts:395-411` | 以 `(submissionId, rejudgeRunId)` 冪等鍵 upsert |
| getTemporalClient 單例 race               | `temporal/src/client.ts:6-13`     | 快取「建立中的 Promise」而非建好的 client       |
| 記憶體量測 50ms /proc 輪詢峰值低估        | `sandbox-runner` `utils.ts:74-98` | 文件化量測精度限制;或縮短輪詢/用 cgroup peak    |

- **verify:** 各項 unit 測試;低優先,可併 Phase 1 尾段。

---

## Phase 2 — 文件誠實度(living-docs 漂移叢集)

> **系統性根因:** doc 與 code 無可執行雙向綁定,大遷移後 curated prose 一律滯後。建議把「grep 已刪檔名/已刪 model 名」納入 doc-link gate。

### Task 2.1 — 🟠 P1:QUALITY_SCORE.md 自稱「None outstanding」但實際多文件漂移

**問題(已驗證 True/True):** `QUALITY_SCORE.md:26` 寫「None outstanding」、Architecture 評 A、Security 評 A-,卻對 PR #128 製造的 DATABASE/THREAT_MODEL 漂移、scoreboard 四文件矛盾全盲。
**修法:** Outstanding Drift 補登本計劃 Phase 2 的所有漂移項;下修 Architecture/Schema/Security 評級或附 caveat 直到漂移清掉(ledger 價值繫於敢承認漂移)。修完 Phase 2 後再回填「已清」。

### Task 2.2 — 🟠 P1:scoreboard 即時更新機制四文件互相矛盾且全與碼不符

**問題(已驗證 True/True):** 程式碼有 Redis pub/sub 驅動的 SSE(`scoreboard/stream` 訂閱 `keys.contestChannel` + `submission-judge.ts:67` `publishScoreboardUpdate` + 10s throttle),但 `ARCHITECTURE.md:412`/`REDIS.md:39` 說「不用 pub/sub、只 30s 輪詢」,`FRONTEND.md:90` 反向捏造「資料來自 Redis」,真正 SSE 路徑零記載。
**修法:** 以 code 為準**統一寫一次**:資料來源=Postgres `buildScoreboard`;即時更新=`contestChannel` 上 `SSE_SCOREBOARD` 事件 + 10s throttle;前端 SSE + 30s 輪詢雙保險。四文件其餘處 link 過去,不再各自重述。

### Task 2.3 — 🟠 P1:THREAT_MODEL.md 維護已移除功能的完整威脅情境 + phantom models

**問題(已驗證 True/True):** `THREAT_MODEL.md` 5 處維護 course join token 威脅(資產表/攻擊面/`/courses/[slug]/join/[token]` 路由/mitigation),但 `CourseJoinToken` model 不存在、無 join token 是 by-design;另列 `PlagiarismReport` model(實為 inline 欄+`PlagiarismPairFlag`)、用舊 `ExamParticipation.ipPin`(已併入 Participation)、稱「Redis for scoreboards」。
**修法:** 刪全部 join-token 條目;`PlagiarismReport`→inline `plagiarism*` 欄 + `PlagiarismPairFlag`;`ExamParticipation`→`Participation`;移除「Redis scoreboards」。威脅模型對不存在功能列威脅會稀釋可信度。

### Task 2.4 — 🟡 P2:其餘文件漂移(批次,以 code 為準重寫)

| #   | 文件                                             | 漂移                                                                                                                                             | 修法                                                                                       |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| a   | `ARCHITECTURE.md:62,103-109,19-22,412`           | temporal「含 workflows」自相矛盾、redis 例外「兩檔」實四檔、domain 目錄漏列 audit/feedback/virtual-contest、scoreboard 同 2.2                    | 對齊 code;redis 檔案清單改引用 eslint allowlist 為單一事實源                               |
| b   | `REDIS.md:16,39-41,7-12`                         | channel「無 nojv: 前綴」實際全有、scoreboard pub/sub 全活著卻說已移除、漏列 `nojv:sb-throttle`、誤指 scoreboard SSE 由 `/api/events/stream` 消費 | channel 表加 `nojv:` 前綴、補 sb-throttle、區分兩個 SSE endpoint                           |
| c   | `incident-recovery.md` Scenario B                | 描述已不存在架構(指向已刪 `scoreboard.ts`、把 fail-closed rate limiter 寫成 fail-open、把 PG cooldown 寫成 Redis)                                | 重寫對齊現況(Redis 僅剩 pub/sub/rate-limit/admin-cache/sb-throttle;flush 幾乎無害)         |
| d   | `RELIABILITY.md:49,104`                          | 「Scoreboard sorted sets rebuilt from DB」「ZRANGE+ZADD」殘留                                                                                    | 刪除(scoreboard 不在 Redis)                                                                |
| e   | `DATABASE.md:17,114-118,182,189-191,263-270,316` | curated prose 仍描述已 drop 三表 + `virtualContestId` 欄 + 三 enum;seed 數字過時                                                                 | 改述單一 Participation 超型;seed 數字對齊 getting-started.md 或 link 過去                  |
| f   | `SECURITY.md:16,124-146`                         | 「signed URL」實為 in-process GetObject;dependency advisory 與 QUALITY_SCORE 對 transitive 矛盾                                                  | 改「read in-process by worker S3 creds」;更新 advisory posture(overrides 已清、audit 為零) |
| g   | `JUDGE_PIPELINE.md:265,270`                      | `deriveJudgeMode` inline 位置與行號 stale、rm -rf 清理行號錯                                                                                     | 改用符號引用(函式名+檔)不釘行號                                                            |
| h   | `gke/README.md:64-66`                            | 「single kubectl apply -k」與正式兩步 flow 矛盾                                                                                                  | 統一為兩步 apply(quota 在第二步是刻意設計)                                                 |
| i   | `gcp/README.md:41-49`                            | deploy.sh 必填 env 清單漏 BETTER*AUTH*\_/S3\_\_                                                                                                  | 補齊對齊 `deploy.sh:77-86` 的 `require_env`                                                |

- **verify:** doc-link gate 綠;隨機抽 3 條技術宣稱到 code 驗證一致。

---

## Phase 3 — 效能熱路徑

> **系統性根因:** 大量「每請求即時從原始 submission 重算衍生視圖」而非物化 read-model,搭配 `invalidateAll` 全頁重載放大。

### Task 3.1 — 🟠 P2:contest scoreboard 重複計算 + 無快取

**問題(機制已驗證):** `contest/scoring.ts:160` `getScoreboardChart` 內部又呼叫 `getScoreboard`,而 `scoreboard/+page.server.ts:34` 又 `Promise.all([getScoreboard, getScoreboardChart])` → 單次頁面載入撈兩次、重建兩次榜,全程無快取;前端每 SSE/30s `invalidateAll()` 全量重跑 loader。
**修法:**

1. `getScoreboardChart` 不再呼叫 `getScoreboard`;改由 `+page.server.ts` 算一次 scoreboard,把 entries/problems 傳進 chart builder(立刻砍一次全量撈+重建)。
2. 對 live(非 frozen/override 變動)情況引入短 TTL 快取(contest channel 版本號 + 進程內或 Redis 1–3s),使同窗口內多次 `invalidateAll` 只觸發一次實算。

- **verify:** 單次 load 只撈一次 submission;快取命中測試。

### Task 3.2 — 🟠 P2:problem 頁 submission 列表 S3 扇出,verdictSummary 形同虛設

**問題(已驗證 True/True):** `submission/queries.ts:265` `listProblemSubmissions` 對最多 50 筆 submission 逐筆 `getVerdictDetail`(各一次 S3 GET),而 `submission.prisma:70-73` 註解明寫 `verdictSummary`(<4KB)「safe to load in list views」且查詢已 select 它。
**修法:** 列表渲染改用 row 內 `verdictSummary` 組 result,移除 :265-269 的 S3 扇出;單筆展開時才 lazy `getVerdictDetail`。單頁 S3 GET 從最多 50 降到 0。

- **verify:** 列表 loader 不打 S3;展開仍取完整 detail。

### Task 3.3 — 🟡 P2:problem 頁 SSR load 串行 await + problems 列表多查詢

| 項                                                  | 檔                                                    | 修法                                                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| problem 頁串行 await 鏈疊 TTFB                      | `problems/[problemId]/+page.server.ts:27,33,43,57,59` | 彼此獨立的 `getProblemPageData`/`listProblemSubmissions`/`resolveActiveContextForUser` 合進同一 `Promise.all`;submissions 改 streamed promise(同 dashboard) |
| problems 列表 ~9 查詢、computeStatusCounts 4 子查詢 | `problem/queries.ts:323,331,390-404`                  | statusCounts 與 filter/分頁無關 → 短 TTL 快取或切 filter 才算;或 4 條合併單一 GROUP BY                                                                      |

### Task 3.4 — 🟡 P2:plagiarismResults O(N²) JSON 行內 over-fetch

**問題:** `PlagiarismResults.pairs`(O(N²×題數))整包 JSON 行內存於 Exam/Assessment/Contest,但 `assessmentRepo.listByUser`/`listAcrossCourses`/`examRepo.listByCourseId`/`contestRepo.listPublished` 等學生面 list 全用 `include`(抓全 scalar),每次列作業/考試把完整 plagiarism JSON 從 TOAST 拉出再丟。
**修法:** list 查詢改顯式 `select` 排除 `plagiarism*` 欄(仿 `selects.ts` 加 `assessmentListSelect`/`examListSelect`);中期把 pairs 移 S3(已有 `plagiarismReportUrl` 前例)或獨立表。

- **verify:** list 查詢不再 select plagiarism 欄。

### Task 3.5 — 🟢 P3:索引與演算法(批次)

| 項                                                  | 檔                           | 修法                                                                                                                            |
| --------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Submission 缺 createdAt 索引(admin 三查詢 seq scan) | `submission.prisma`          | 加 `@@index([createdAt])`(或 `[sampleOnly, createdAt]`);SubmissionRejudgeLog 加 `@@index([createdAt])`                          |
| better-auth 表缺索引                                | `auth.prisma`                | Session/Account 加 `@@index([userId])`、Account 加 `@@unique([providerId, accountId])`、Verification 加 `@@index([identifier])` |
| point-sum builder O(P·Q·S) 重複 filter              | `scoring/point-sum.ts:43-44` | 重建前把 userSubs 依 problemId 分桶(Map),內層改 O(1)                                                                            |
| findDistinctAcByUser in-memory distinct             | `submission.ts:482-491`      | 改 `groupBy(["problemId"])` 或 raw `SELECT DISTINCT` 下推 DB                                                                    |

---

## Phase 4 — 死契約清理 + 重複收斂 + 程式品質

> **系統性根因 A:** 大量「定義了但沒 producer/sender/consumer」的半條線(功能拆三段分批落地、某段忘了)。
> **系統性根因 B:** 同概念在缺跨層型別契約處反覆手刻;ESLint 邊界守衛擋掉「正確的共用」逼出複製。

### Task 4.1 — 死契約清除(批次,跨 arch/judge/redis/frontend/database 四維)

| #   | 死契約                                                              | 檔                                                                  | 修法                                                                                                                                             |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| a   | `adminOverrideSignal`(無 sender,3 維獨立指認)+ `newEndsAt` 設計 bug | `contest-lifecycle.ts:17-30,48-67`、`temporal/types.ts:39`          | 刪 signal/handler/`AdminOverrideSignal` 型別/re-export(兩個 eslint-disable 一併消);ARCHITECTURE.md 表改記「re-dispatch with TERMINATE_EXISTING」 |
| b   | `publishAssessmentDeadline`(無 producer 死 activity)                | `redis/pubsub.ts:72-80` + bundle 註冊                               | 刪 activity/`assessmentChannel`/`SSE_ASSIGNMENT_DEADLINE`/client handler(或記 plans TODO)                                                        |
| c   | sse.ts 三個 contest/deadline toast handler(從不訂閱該 channel)      | `stores/sse.ts:125-133`                                             | 刪三分支 + i18n key,或讓 `/api/events/stream` 訂閱 contestChannel                                                                                |
| d   | Scoreboard Friends/Around-me 死 UI(`onChange={()=>{}}`)             | `scoreboard/+page.svelte:278-286`、`contests/[id]/+page.svelte:203` | 實作前端過濾(資料已在 client),或拆掉假分頁                                                                                                       |
| e   | `notificationRepo.createAndCap` 丟棄 dedupeKey                      | `notification.ts:29-36`                                             | 補 `dedupeKey: input.dedupeKey ?? null` + 處理 P2002;或從共用 input 型別移出                                                                     |

### Task 4.2 — 🟡 P2:context 概念複製 6 份 → 收斂 core schema

**問題:** assessment context(assignment/exam/contest 三態聯集)在 domain 寫 3 份(`clarification/types.ts` 與 `score-override/types.ts` 逐字元相同的 `toContextDbFields`/`fromContextDbFields`)、API route 又手刻第 4-6 份(`overrides`/`clarifications`/`feedback` 的 `contextSchema`+`parseContextQuery`)。
**修法:**

1. `@nojv/core` 定義 canonical `assessmentContextSchema`(discriminatedUnion)+ generic `toContextDbFields`/`fromContextDbFields`。
2. domain clarification/score-override 共用;feedback 因儲存欄不同保留 map 但重用 context 型別。
3. 三個 route 共用 `parseContextQuery`(提到 `$lib/server/shared/` 或 import core);feedback 用 `.pick`/變體表達「不含 contest」而非整段複製。

### Task 4.3 — 🟡 P2:form action 缺統一錯誤 wrapper(22 中僅 10 用 classifyError)

**問題:** `action-handlers.ts` 的 `withRateLimit` 只限流不捕錯;對比 API 入口 `apiHandler` / loader 入口 `handleLoad` 都自動 catch。domain throw 在 12 個 action 變裸 500(例:`announcements` create 通過 null-check 但超 `.max()` 的 title → 未捕 ZodError → 500 而非 400 fail)。
**修法:** 提供 `withAction`(或讓 `withRateLimit` 組合 catch 層)把 domain HttpError/ZodError 統一轉 `fail(status, {error})`,三條入口錯誤處理對稱;補齊另外 12 個 action。

- **verify:** 超長 title 的 action 回 400 帶欄位訊息。

### Task 4.4 — 🟡 P2:sandbox executors 重複「寫 source files + 主檔回退」邏輯 ×7

**問題:** k8s/standard/interactive/advanced 四 executor 各自貼一份「遍歷 sourceFiles→正規化→主檔回退 sourceCode」,3 種變數名(`wroteMainSource`/`wroteDefaultSource`/`wroteDefault`)。主檔回退規則改一次要改 7 處。
**修法:** 抽 `resolveSourceFiles(request): {path, content}[]`(已正規化、已含主檔回退);k8s 折成 ConfigMap、docker 折成 fileWrites。

- **verify:** 主檔回退單一真相 + 測試。

### Task 4.5 — 🟢 P2/P3:其餘重複與整潔(批次)

| 項                                            | 檔                                                             | 修法                                                                            |
| --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| EditorCore vs MonacoScriptEditor 重複包裝器   | `editors/MonacoScriptEditor.svelte`、`EditorCore.svelte`       | 抽共用 `createMonacoEditor` 控制器或 base 元件,差異只留 completion/readOnly     |
| plagiarism results JSON 兩處手寫鬆散解析      | `server/plagiarism-pair.ts:44-70`、`domain queries.ts:138-141` | domain 定義 `plagiarismResultsSchema`(zod)回傳已解析 pairs,刪 web 的 parsePairs |
| DEFAULT_ATTEMPT_RESET_MINUTE 註解 mirror 兩份 | `utils/attempt-reset-time.ts:3`、`domain attempt-window.ts:6`  | 移到 `@nojv/core`(零依賴雙端可 import),消除複製                                 |
| verdict/language narrowing idiom ×9           | `submission/queries.ts` 等                                     | 抽 `narrowSubmissionRow(s)` helper                                              |
| buildStarterByLanguage 過度 export            | `problem/queries.ts:78`                                        | 移除 export 改檔內 private;評估導入 knip                                        |
| ScoreOverrideForm $state IIFE 包裝            | `ScoreOverrideForm.svelte:50-55`                               | 直接運算式初始化                                                                |

---

## Phase 5 — 組態守衛 + Redis/Infra 硬化 + 安全深度防禦

### Task 5.1 — 🟡 P2:turbo lint 靜默跳過 @nojv/temporal + apps/sandbox-runner

**問題:** 兩套件 package.json 無 lint script,`turbo lint` 靜默跳過 → 從未被 strictTypeChecked ESLint 檢查(sandbox-runner 是安全關鍵 runtime)。
**修法:** 兩套件加 `"lint": "eslint ."`;temporal 加 `no-restricted-imports` 禁 @nojv/db、@nojv/domain;加 fitness test 斷言「每個 workspace package 都有 lint script」。

### Task 5.2 — 🟡 P2:workflow/query 名稱裸字串跨套件契約無 fitness test

**問題:** `dispatch.ts` 以字串 `"submissionJudgeWorkflow"`/`"getStatus"` 啟動/查詢,對側 worker `defineQuery("getStatus")` 是獨立字面值;改名只在 runtime 失敗。
**修法:** 名稱常數收進 `@nojv/temporal`(`SUBMISSION_JUDGE_WORKFLOW`/`QUERY_GET_STATUS`),兩側共用(temporal 仍零依賴 domain);或加讀 workflows index export 名 vs dispatch 字串集合比對的 fitness test。

- **注意:** 上輪 T1 `workflow-registration.test.ts` 已部分覆蓋——查證後若已足則只補常數收斂。

### Task 5.3 — 🟡 P2:CHECK constraint + FTS GIN 只在 migration SQL,測試 DB 沒有

**問題:** `global-setup.ts:24` 用 `db push` 建測試 DB,`Submission_single_context_chk`/`Participation_single_context_chk` 等 CHECK 與 `ProblemStatementI18n_fts_idx` 是 raw-SQL migration 產物 → 測試 DB 從未擁有;違反 CHECK 的路徑整合測試全綠、prod 才炸。
**修法:** global-setup 在 db push 後加一步:從 migrations 抽 `ALTER TABLE ... ADD CONSTRAINT`/`CREATE INDEX ... USING GIN` 重放進測試 DB(或維護 `constraints.sql` + parity 測試比對 `pg_constraint`)。

- **verify:** 違反 single-context 的寫入在 integration 被 CHECK 擋。

### Task 5.4 — 🟡 P2:Participation status 降級裸 TEXT + per-type 欄 nullable

**問題:** `contest.prisma:278` `status String` 取代被 drop 的三個 enum,DB 不再限值域;`exam/detail.ts:199` 裸 `as` cast。virtual 的 `startedAt`/`endsAt` 變 nullable,`findVirtual` 回 null 但 row 占 unique key → `startVirtualContest` create→P2002→findVirtual null→rethrow,user×contest 永久卡死。
**修法:** 加 `ParticipationStatus` Prisma enum 替換 String;migration 補 CHECK(type=virtual 時 startedAt/endsAt NOT NULL、ipPin/ipGateExemptUntil 僅 exam);`startVirtualContest` 對「row 存在但欄缺損」給明確錯誤而非 rethrow P2002。修 `contest.prisma:266-268` 與 IpViolationLog 過時/矛盾註解。

### Task 5.5 — 🟡 P2:exam-context cache 跨實例失效 30s under-gating 窗口

**問題:** `exam-context-cache.ts` 是 per-instance Map(TTL 30s),`invalidateExamContextCaches` 只清本機;`web.cloudrun.yaml` maxScale 15 無 session affinity 無跨實例廣播。攻擊:先打實例 B 讓 B 快取 null,再到 A `startSession`,30s 內被 LB 派到 B 的提交(domain 不驗 IP)跳過 IP gate(`hooks.server.ts:344` cached null 直接 return null)。
**修法(最小):** null(無 context)結果不快取或縮到 2-3s TTL(null→active 才是安全敏感方向);或 Redis pub/sub 廣播 user-level 失效(已有 subscriber 基建);至少 REDIS.md/RELIABILITY 記下「per-instance best-effort,安全強制以每請求 live `checkProctoringGate` 為準」並評估對提交路徑加一次不經快取的 IP 檢查。

### Task 5.6 — 🟡 P2:rate limiter fail-closed 近死碼 + Redis 中斷每請求懸掛 10s

**問題:** `createRateLimiter` try/catch 包 `getRedis()`,但 ioredis 對連不上的 Redis 不 throw(背景重試),所以 REDIS.md:59「construction-time fail-closed」描述不存在的機制,測試 mock 的是 prod 不會發生的情境。真實 Redis 中斷時每 `consume` 先在 offline queue 懸掛約 10s 才 reject。
**修法:** rate limiter 建專用連線設 `enableOfflineQueue: false`(或 `maxRetriesPerRequest: 1`)讓 Redis 中斷快速 429;修 REDIS.md:59 與單元測試涵蓋「runtime Redis 斷線→consume reject→429」真實路徑。

### Task 5.7 — 🟢 P3:Redis/env 殘渣與不對稱(批次)

| 項                                                            | 檔                                   | 修法                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| web REDIS_URL prod 默認 localhost(與 worker fail-fast 不對稱) | `web env.ts:13`                      | NODE_ENV=production 時 REDIS_URL/DATABASE_URL 不得落 default,getWebEnv() fail-fast                       |
| seed.ts 殘留 Redis 連線(import 只為 finally quit)             | `prisma/seed.ts:1,100`               | 刪 import 與 quit;若 @nojv/db→@nojv/redis runtime dep 歸零連 package.json + ARCHITECTURE footnote 一併清 |
| pubsub.ts 五處 `/* see module header */` 孤兒註解             | `redis/pubsub.ts:34,54,67,77,89,117` | 每個 catch 補一行實際理由(best-effort SSE,client 有 reconnect fallback)                                  |
| EXECUTION_BACKEND 在 deploy.sh 未顯式設                       | `cloud-build/deploy.sh`              | `--set-env-vars` 顯式設 EXECUTION_BACKEND/NODE_ENV 對齊 reference manifest                               |

### Task 5.8 — 🟡 P2:SSE client 重連永久放棄 + reconnect 計數設計缺陷

**問題:** `sse.ts:66` reconnect ≥10 次永久放棄無 UI 訊號;`reconnectAttempts` 只在 `onmessage` 歸零、不在 `onopen`,server 每 10 分鐘強制切線(keepalive 是 comment 不觸發 onmessage)→ 閒置分頁約 100-105 分鐘後 SSE 靜默死亡;clarification 的「since 重新對帳」client 端從未實作。
**修法:** `reconnectAttempts = 0` 移到 `onopen`(或對正常 10 分鐘切線不計數);重連成功觸發 clarification store 帶 `since` reconcile(API 已備);放棄後改 visibilitychange/online 事件再嘗試或顯示「即時更新已中斷」。

### Task 5.9 — 🟡 P2:CD postgres-backup 從未啟動 + SLO 無 page-able 告警

| 項                                                           | 檔                                         | 修法                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自架 CD 路徑無備份(postgres-backup sidecar 從不啟動)         | `docker-compose.yml:229`、`deploy.yml:109` | deploy.yml 基礎設施步驟加 `--profile backup`,BACKUP_DIR 指 off-box;或文件明標此路徑非備援                                                           |
| SLO 告警全 warning 全 latency,無 availability/crashloop page | `grafana/alerts/slo-alerts.json`           | 加 critical 級 availability/error-rate 告警(5xx 比率、judge system_error 比率、worker ready replica<1、Temporal schedule-to-start 暴增)導 page-able |
| CD health 失敗無回滾                                         | `deploy.yml:126-188`                       | health 失敗回滾上個 image tag;runbook 標 migration 須 expand-then-contract                                                                          |

### Task 5.10 — 安全深度防禦(批次)

| 項                                                       | 檔                                                    | 修法                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟡 P2 sandbox 隔離依賴運維手動套用,程式層不自證          | `k8s/sandbox/network-policy.yaml`、`SECURITY.md:43`   | 部署 runbook 加上線後驗證步(臨時 pod curl 外網應 timeout、確認 CNI NetworkPolicy enforcement 啟用);Cloud Armor allowlist↔client-ip.ts header 一致性檢查 |
| 🟢 P3 better-auth accountLinking 無 trustedProviders     | `auth.server.ts:114-116`                              | 顯式設 `trustedProviders` + 評估 social 註冊繞過 `disableSignUp` 的不對稱;文件化「已評估可接受」                                                        |
| 🟢 P3 markdown ADD_ATTR 全域開 style/class/href          | `utils/markdown.ts:45`                                | tag-scoped 屬性允許把 style/class 限縮在 KaTeX 子樹;或從 ADD_ATTR 移除 style                                                                            |
| 🟢 P3 BODY_SIZE_LIMIT 64MB vs 50KB source                | `docker-compose.yml:150`、`submissions/+server.ts:14` | 提交/編輯類純 JSON 路由設遠小於 64MB 上限;解析前以 Content-Length 預擋                                                                                  |
| 🟢 P3 avatar 上傳只信 client MIME                        | `account/avatar/+server.ts:20`                        | 過 `detectImageMime` 對齊其他兩條上傳路徑                                                                                                               |
| 🟢 P3 verdict sanitizer fail-open(parse 失敗回原始 blob) | `submissions/[id]/+server.ts:12`、stream 版           | parse 失敗改回 null 或跑寬鬆 stripStaffFeedback;收斂兩份 route-local 複本到 domain 單一出口                                                             |
| 🟢 P3 editorial authored 早回傳繞 context gate           | `editorial/queries.ts:52`                             | authored 早回傳移到 `contextGateOpen` 之後,或 authored 時只看自己的題解                                                                                 |
| 🟢 P3 exam heartbeat 端點孤兒(前端無呼叫者)              | `api/exam-sessions/[examId]/heartbeat/+server.ts`     | 確認產品意圖:要監控就補 exam shell 定時呼叫(注意 rate limit);否則刪端點+domain throttle+metrics+openapi                                                 |
| 🟢 P3 createOverride 不驗 target 屬於 context            | `score-override/mutations.ts:77`                      | 加 assertProblemInContext + assertUserParticipatesInContext 給明確 4xx                                                                                  |
| 🟢 P3 bundle route 缺 canCreateProblem 守衛(守衛不對稱)  | `api/problems/[id]/bundle/+server.ts`                 | 補對齊的 canCreateProblem 前置檢查(ownership 仍是真邊界,純一致性)                                                                                       |

### Task 5.11 — 前端 a11y / i18n / 一致性(批次)

| 項                                                                | 檔                                                      | 修法                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 🟡 P2 教師 detail 頁全量 eager 載入 + invalidateAll 粗刷          | `assignments/[id]/+page.server.ts:64`、`exams/[id]`     | 重 tab 改 streamed promise 或切 tab 才打子端點;各資料源加 `depends()` key                           |
| 🟡 P2 problem picker 三重實作 + difficultyClass 4 份副本          | `exams/new`、`assignments/new`、`AssignmentProblemsTab` | 抽 `ProblemPicker.svelte`;difficultyClass 收斂回 `verdict-style.ts`;統一 updateProblems wire format |
| 🟡 P2 server action 回傳英文字串繞 i18n + FormMessage 三套慣例    | `exams/[id]/+page.server.ts:337` 等                     | 統一 sentinel/error-code + client paraglide 對映;硬編碼字串補進 catalog                             |
| 🟡 P2 tab 導航三套實作 ARIA 各自為政 + 狀態不進 URL               | `exams/[id]`、`assignments/[id]`                        | 抽正確 APG tabs(或 Bits UI Tabs)共用元件,tab key 同步 URL `?tab=`                                   |
| 🟡 P2 submission polling 30s 硬上限誤報失敗 + 歷史永久卡 pending  | `services/submission-service.ts:42`、`use-editor-run`   | dispatch 成功後改背景無上限(或 5-10 分)輪詢持續更新 entry;逾時改中性「仍在評測中」                  |
| 🟡 P2 SubmissionHistoryPanel 用索引當 each key,prepend 時詳情錯位 | `SubmissionHistoryPanel.svelte:200`                     | each key 改 `entry.id`,viewing 狀態存 submission id                                                 |
| 🟢 P3 獎牌金銀銅裸 hex 散落 + 銀色不一致 + ECharts token 三份複製 | `RankBadge.svelte` 等                                   | 加 `--rank-gold/silver/bronze` token;ECharts theme 抽 `chart-theme.svelte.ts`                       |
| 🟢 P3 表單缺 aria-invalid/describedby(橫向缺口)                   | `ScoreOverrideForm.svelte` 等                           | 共用 Input 層統一 aria-invalid + 錯誤 `<p>` id 綁定                                                 |
| 🟢 P3 EditorialListPanel submit 失敗無回饋 + 未 Zod 驗證          | `EditorialListPanel.svelte:127`                         | 補 toast 錯誤路徑;`res.json()` 過 schema                                                            |
| 🟢 P3 建立頁步驟編號跳號 + 假 label for + 搜尋框無 aria-label     | `exams/new`、`assignments/new`                          | 編號迴圈產生;假 label 改 fieldset/legend;搜尋框補 aria-label                                        |

---

## 驗證(全域)

- 每個 Phase 完成跑 `pnpm ci:verify`(typecheck + lint + unit + integration + fitness)。
- Phase 0/1 的判題/沙箱項:nightly 實機判題矩陣必須實跑(本機 `pnpm sandbox:build` 後驗),不可只靠 mocked 測試。
- Phase 2 完成後回填 `QUALITY_SCORE.md` 的 Outstanding Drift 為「已清」並校正評級。
- 每個安全/正確性修復(Phase 0)補對應 regression 測試,且**先寫測試重現再修**。

## 風險 / 注意

- **Task 0.3 / 0.4 / 5.3 / 5.4 動 migration**:dev 是 `db push` 管理,不能跑 `migrate dev`(會提示 reset);先 `db push` 驗證再寫 migration,注意 CHECK/GIN 走 raw-SQL(`migrate diff --exit-code` 零漂移 gate)。
- **Task 1.3(CPU time)/ 1.4(workflow versioning)是設計級**:動 verdict 邏輯或部署範式前先寫設計 doc(brainstorm → design),不要直接改。
- **Task 4.2 / 4.5(context schema 下沉 core、常數移 core)**:注意 client 不能 value-import domain 的 ESLint 守衛——這正是要把 client-safe 純物下沉 `@nojv/core` 的原因(零依賴雙端可 import)。
- **執行順序建議:** Phase 0 → 1 → 2 並行(文件可與程式平行)→ 3 → 4 → 5。Phase 0 四個安全/正確性項應最先且各自獨立 PR(易 review、易回退)。
