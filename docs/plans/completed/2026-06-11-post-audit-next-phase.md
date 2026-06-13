# 稽核後下一階段 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: 實作時用 superpowers:executing-plans 逐 task 進行。

**Goal:** 收尾 2026-06-10 全 codebase 稽核**修復後仍未做**的工作——分三類:(A) 需要測試基建才能補的測試、(B) 可直接做但先前遞延的測試品質項、(C) 首席架構師三個結構性風險(需設計決策、各自規模大)。

**Context:** 稽核缺陷修復已完成並驗證,見 [`docs/plans/completed/2026-06-10-audit-remediation.md`](./2026-06-10-audit-remediation.md)(含附錄 D 對抗式驗證結果)。本計劃只涵蓋**那份計劃刻意未做、或查證後判定需另開計劃**的剩餘項。

**Tech Stack:** SvelteKit + better-auth + Temporal + Prisma 7 + Redis + Vitest。

---

## 實作狀態(2026-06-11)

本計劃的 Phase 1/2 + 風險 #1 第一步 + 風險 #3 第一步**已於本 PR 實作並驗證**(`ci:verify` 26/26 + 1285 unit + 1591 integration 全綠)。逐項:

| 項目                              | 狀態      | 落地處                                                                                                |
| --------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| 風險 #1 — scoring 純核心抽取      | ✅ 已實作 | `packages/application/src/scoring/persist-core.ts` + contest/exam scoring.ts + persist-core.test.ts   |
| 1.1 HTTP harness                  | ✅ 已實作 | `tests/integration/http/_harness.ts` + `tests/setup/stubs/*` + vitest.config alias                    |
| 1.2 signup-disabled 端點測試      | ✅ 已實作 | `tests/integration/http/auth-signup.test.ts`                                                          |
| 1.3 守衛鏈 request 層測試         | ✅ 已實作 | `tests/integration/http/{hooks-guards,notifications,healthz}.test.ts`                                 |
| 2.1 editorials e2e fail-loud      | ✅ 已實作 | `tests/e2e/editorials.test.ts`(opt-in 後非 AC 改 explicit assert)                                     |
| 2.2 seed TABLES 漂移防護          | ✅ 已實作 | `tests/unit/db/seed-tables-complete.test.ts`(T5)+ 補齊 15 個漏列 table                                |
| 2.3 workflow 分支選擇測試(輕路線) | ✅ 已實作 | 抽 `resolveScoringDispatch` 純函式 + `submission-judge-helpers.test.ts`(免 `@temporalio/testing` dep) |
| 2.4 nightly 沙箱隔離 CI           | ✅ 已實作 | `.github/workflows/nightly-sandbox.yml`(schedule + manual,不阻塞 PR)                                  |
| 風險 #3 — config fitness 盤點     | ✅ 已完成 | T1–T6 fitness 測試全補(T3/T4/T6 於第二輪)+ 缺口 A/B/C 修復(見該節)                                    |
| 風險 #2 — Temporal 拓撲           | ✅ 已決   | 維持自架(2026-06-11 拍板,不採 Temporal Cloud / pg-boss;不改 infra)                                    |
| 風險 #1 — 三胞胎模型完整收斂      | ✅ 已完成 | Participation 超型統一(PR #128),Submission FK 收斂、3 表 drop                                         |

---

## 不做清單(查證後判定為「做了會更糟/框架要求」,別重啟)

> 這些在稽核時被點出、也曾排入計劃,但實作前查證發現**不該做**。列此避免下一輪稽核重提。

- **3.1 `parentClosePolicy=ABANDON`** — 會切斷 `cancelRejudge` 仰賴的 cancellation 傳播。批內錯誤隔離已用 `Promise.all` + 逐 child `try/catch` 達成,ABANDON 是淨退步。
- **5.3 GIN 全文索引** — `to_tsvector(...)` 表達式 GIN 無法用 Prisma schema 宣告,需 raw-SQL migration,會讓 CI 的 `migrate diff --exit-code` 零漂移 gate 永久紅。題目表小、搜尋已足夠快。
- **7.4 withTx 樣板去重** — repo 的 top-level(`prisma`,讀取/聚合)與 withTx(`tx`,mutation)方法**刻意是不同集合**;共用 `makeRepo(client)` factory 會把 tx-only mutation 暴露成 top-level 非交易方法,侵蝕 Wave 7.2 剛建立的交易邊界。
- **7.2 移除 `@nojv/db` 的 Prisma namespace 匯出** — better-auth 的 Prisma adapter 需要 raw `PrismaClient`/`Prisma`。13 處 raw `tx.model.*` 已全部改走 repository,這是唯一刻意保留的框架例外。

---

## Phase 1 — Web HTTP 邊界測試基建(解鎖多個遞延測試)

**為什麼先做:** 1.1(signup-disabled 端點測試)與 6.6(route handler + hooks 守衛鏈 request 層測試)都卡在「沒有能在 vitest/CI 內呼叫 SvelteKit route handler 與 hooks 的 harness」。`auth.server.ts` 用 `$env/dynamic/private`,vitest 無法直接 import。這也是首席架構師「mock 邊界盲區」(結構性風險 #3)在 web 層的具體缺口。

### Task 1.1: 建 in-process SvelteKit handler 測試 harness — ✅ 已實作(2026-06-11)

> **已落地:**`tests/integration/http/_harness.ts`(`callRoute(opts)`)+ `tests/setup/stubs/{env-dynamic-private,env-dynamic-public,app-environment}.ts` + `vitest.config.ts` 的 `$env/*`、`$app/environment` alias。harness 動態 import 真 `handle`、組 `RequestEvent`、用結構性偵測把守衛拋出的 redirect/error 轉成 `Response`(type-only import `@sveltejs/kit`,避免從 repo 根解析不到 kit)。HTTP 整合測試標 `30_000ms` timeout(首次 import 冷啟動 ~6s)。

**結論:採方案 (c)** — import 真實 `handle` + 真實 handler fn,用手建 `RequestEvent` 驅動,只 stub vitest 解析不了的三樣(`$env/dynamic/private`、`$app/environment`、auth cookie seam)。(a) `new Server(manifest)`/`installPolyfills` 在 `@sveltejs/kit` 2.61.1 **無公開穩定 export**(只在 `./internal/server`,需 `vite build` 生成 manifest,patch bump 即碎)——**否決**;(b) build node adapter + ephemeral port 最真實但重、且與既有 serial-Postgres + storage-mock 模型衝突,**那一層已由 Playwright E2E 覆蓋**——否決。

**為什麼 (c) 阻礙比預期小**:全 repo 只有 3 檔 import `$env/dynamic/private`(都經 `$lib/server/env.ts` 的 `getWebEnv()` 單一 wrapper),只有 1 檔(`rate-limiter.ts`)import `$app/environment`,兩者都能在 `vitest.config.ts` 用 alias 指到 stub。

**具體步驟:**

1. **Alias stub**(`vitest.config.ts` 的 `sharedAliases`):`$env/dynamic/private` → `tests/setup/stubs/env-dynamic-private.ts`(body:`export const env = process.env;`,讓 `env.ts` 的真 zod 驗證跑在 global-setup 已載入的真 `.env` 上;`BETTER_AUTH_SECRET` 非 prod 會自動生成);`$app/environment` → stub(`export const dev = true/false; browser=false; building=false;`,`dev=true` 取 rate-limiter ×1000 budget 給測試 headroom)。
2. **Session factory**(`tests/fixtures/factories.ts`):`createTestSession(userId)` 插一筆真 `Session` row(`Session` 已在 seed-test-db TABLES,不會跨測洩漏)。
3. **Harness**(`tests/integration/http/_harness.ts`):`callRoute(pathname, {method, body, user, ip, headers})` → 動態 import `apps/web/src/hooks.server` 的真 `handle`,組 `RequestEvent`(`x-test-user-id` 驅動 stubbed `getSession`、`x-dev-ip` 驅動 `getClientIp` dev 分支、非 GET 自動補 `x-requested-with: fetch` 過 CSRF),`resolve` 內動態 import 對應 `+server.ts` 呼叫真 handler。用 `vi.mock("$lib/auth.server")` 讓 `getAuth().api.getSession` 用 `x-test-user-id` 撈真 `User` row → 驅動**整條真實守衛鏈**(`enforceAccountState`→`enforcePasswordChange`→`enforceAdminTwoFactor`→`enforcePageLock`→`enforceExamGate`),繞過 cookie 加密(那是 better-auth 自己的事,不是受測標的)。
4. **放在 `tests/integration/http/**.test.ts`**,自動繼承既有 `global-setup`(db push)、`integration-setup`(storage mock + truncate beforeEach)、`fileParallelism:false`。

**驗收/最小範例:**`GET /api/healthz` 斷言 200 + `body.ok===true`;`GET /api/notifications` 未登入斷言 **401**(端到端證明 `requireApiAuth`→`HttpError(401)`→`api-handler.ts` `classifyError`→`json(...,{status:401})`,目前零覆蓋),登入斷言 200 + `items[]`。

**Gotcha:**(1) Redis 必跑(rate-limiter module-load 建 `RateLimiterRedis`,每 request `.consume(ip)`)——測試間用不同 `x-dev-ip` 或 stub `dev=true` 避免互相 429;(2) 寫入路由要 `x-requested-with: fetch` 過 `enforceApiCsrf`(`/api/auth` 除外);(3) `hooks.server.ts:1` 首行 `import "$lib/server/otel"`,若測試噪音大再 alias 到 noop(無 OTLP endpoint 時可能本就 inert,先驗再 stub)。

### Task 1.2: 補 1.1 — 公開註冊停用端點測試 — ✅ 已實作

- `tests/integration/http/auth-signup.test.ts`:`POST /api/auth/sign-up/email` 走真實 `handle`→`handleApiAuthRoute`→真 better-auth handler → 斷言 4xx。改回 `disableSignUp:false` 會讓測試紅。

### Task 1.3: 補 6.6 — 守衛鏈 request 層邊界測試 — ✅ 已實作

- `tests/integration/http/hooks-guards.test.ts`:`mustChangePassword` → 302 `/account/change-password`、admin 未開 2FA 進 `/admin` → 302 `/account/two-factor`、disabled 帳號 → 清 session + 302 `/signin`。
- `tests/integration/http/notifications.test.ts`:未登入 → 401(端到端證明 `requireApiAuth`→`HttpError(401)`→`api-handler` status mapping)、登入 → 200 + `items[]`。
- **範圍說明**:harness 驅動 `hooks.server.handle` 的守衛鏈;「未登入存取 `(app)` → /signin」與「exam IP gate /api」由 layout load / exam participation 驅動,前者非 hooks 責任、後者需 active exam 設置,留待擴充。

---

## Phase 2 — 可直接做的測試品質項(6.6 殘留,無基建阻礙)

### Task 2.1: editorials e2e fail-loud — ✅ 已實作

- `tests/e2e/editorials.test.ts`:原本 opt-in(`NOJV_E2E_RUN_JUDGE=1`)後判題沒到 `accepted` 仍 **silent skip** 整條 CRUD 鏈;改成 explicit `expect(verdict).toBe("accepted")`——opt-in 即斷言判題環境可用,非 AC 是真 regression。(行 53 的 1.5s 是帶 deadline 的輪詢間隔、本就是 wait-for,保留。)

### Task 2.2: seed TABLES 漂移防護 — ✅ 已實作

- `tests/unit/db/seed-tables-complete.test.ts`(T5):靜態讀 `prisma/schema/*.prisma` 全 model vs `seed-test-db.ts` 的 `TABLES`,**漏列即 fail**。同時補齊先前 15 個漏列 table(原本靠 `TRUNCATE CASCADE` 僥倖兜住,脆弱)。

### Task 2.3: workflow 分支選擇測試 — ✅ 已實作(輕路線,免 dep)

- **決策(2026-06-11):** 不引入 `@temporalio/testing`(會新增重量級 dep + 下載 Temporal test server 二進位 + CI flakiness)。改採**既有慣例**(`exam-auto-close-workflow.test.ts` 把決策邏輯抽純函式直接測,不跑 `TestWorkflowEnvironment`)。
- **落地:** 把 submission-judge workflow 的 **context → 計分路徑分支**抽成純函式 `resolveScoringDispatch(submission) -> {kind:"contest"|"exam"|"none", ...}`(`apps/worker/src/workflows/submission-judge-helpers.ts`);workflow 改用它分派。`tests/unit/worker/submission-judge-helpers.test.ts` 鎖住:contest 路徑、**exam 路徑(正是 PR #83 漏掉的分支)**、practice=none、兩 FK 都在時 contest 優先。
- **未覆蓋(本就需 Temporal,不在輕路線):** 活動實際呼叫(`updateContestScores`/`updateExamScores`/`publishScoreboardUpdate`)的編排、rejudge 取消還原。其註冊面由 T1 守住、計分內部由 persist-core + race 測試守住。

### Task 2.4: nightly 沙箱隔離 CI — ✅ 已實作

- `.github/workflows/nightly-sandbox.yml`(schedule + `workflow_dispatch`,**獨立 workflow 不阻塞 PR**):`pnpm sandbox:build` → 跑 `tests/unit/worker` → 用 executor 的真實硬化旗標(`--network none` / `--cap-drop ALL` / `no-new-privileges` / `--read-only` / `--user 10001`)`docker run` 斷言非 root uid、read-only rootfs、network none、caps dropped。
- **注意:** 本機無法實跑(需 build image + 跑容器),correct-by-construction(鏡像 `standard-mode-executor.ts` 旗標);首次真實驗證在第一次 nightly 排程。

---

## Phase 3 — 結構性風險(首席架構師三項;各需獨立設計計劃)

> 這三項是**設計級**決策,規模遠超補丁;本計劃只列方向與第一步,實作前應各自開獨立設計計劃(brainstorming → design doc → implementation plan)。

### 風險 #1 — Contest / Exam / Assessment 三胞胎模型收斂

- **現狀痛點:** `Submission` 扛 `contestId`/`examId`/`assessmentId`/`virtualContestId` 多個 nullable context FK + XOR CHECK;`contest/scoring.ts` 與 `exam/scoring.ts` 近乎逐函式同構;persist-score 編排層複製(正是已出貨 P1「exam 判題沒呼叫 updateExamScores」的案發現場)。Wave R 的命名統一只是表面第一步。
- **方向:** 收斂成多態 timed-assessment 實體,或至少把 persist-best-score 編排層收成單一實作 + 薄 adapter。

#### 第一步 spike — ✅ 已調查完成並**已實作**(2026-06-11)

> **已落地:**`packages/application/src/scoring/persist-core.ts` 匯出 `computeBestScoreState` / `computeProblemCountState` 兩個無 I/O 純函式;contest/exam 兩邊 `persist*Score` 已改呼叫它們。新增 `tests/unit/domain/scoring/persist-core.test.ts`(8 例,含 override 無條件覆蓋回歸),`contest/exam-scoring-race` 行為等價守門全綠。**out-of-scope 部分(updateXScores 外層、updateWithVersion 泛型化、Submission FK 多型化)未動,留待獨立計劃。**

**調查結論:唯讀計分核心已收斂得很好沒重複(`scoring/scoreboard-builder.ts`、`scoring/problem-count.ts`、`scoring/rank-util.ts` 三方共用);真正的重複在 persist 路徑。**

| `contest/scoring.ts`              | `exam/scoring.ts`          | 差異                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `persistContestBestScore`         | `persistBestScore`         | **body 幾乎逐字相同**;bestByProblem 取 max + override merge + totalScore/subtaskScores 累加 + `updateWithVersion`。唯一差別是 `contestProblems` vs `examProblems` map 名稱。                                                                                                                                                                                                         |
| `persistContestProblemCountScore` | `persistProblemCountScore` | 逐行幾乎相同;只差 `participation.contest` vs `participation.exam`、型別名。                                                                                                                                                                                                                                                                                                          |
| `updateContestScores`             | `updateExamScores`         | 同構 retry loop;**但外層有真實 context 差異**:(a) 回傳值不同(contest 回 `contestId` 給 `publishScoreboardUpdate`,exam 回 `void`);(b) submission 抓法不同(contest 走 `findForParticipationScoring(participationId)`,exam 走 inline `findMany({examId,userId})`——FK 模型差異,不是巧合);(c) conflict class 不同(`ParticipationVersionConflict` vs `ExamParticipationVersionConflict`)。 |

**最小、低風險、可獨立 PR 的第一步抽取點 = persist 計分純核心**(因 `persistContestBestScore`/`persistBestScore` body 幾乎逐字相同):

1. 新增 `packages/application/src/scoring/persist-core.ts`,匯出兩個**無 I/O 純函式**:
   - `computeBestScoreState({ submissions, problemIds: Set, overrides, userId }) -> { totalScore, subtaskScores: Record<string,number> }`(搬 `persistContestBestScore` 計分核心)
   - `computeProblemCountState({ submissions, problemIds: Set, sessionStartsAt }) -> { score, penaltySeconds }`(內部已共用 `computeProblemCountPenalty`,只剩 byProblem 分組 + 累加重複)
   - 入參用**結構型別**(只取 `problemId`/`score`),別綁 Prisma 生成型別以免耦合。
2. `scoring/index.ts` 加 `export * from "./persist-core"`。
3. contest/exam 兩邊的 `persist*Score` body 改成呼叫純函式算 state,再各自 `await xParticipationRepo.updateWithVersion(...)`。**保留** override 過濾(`row.userId === participation.userId`)、`xProblems.has` 過濾。
4. 新增 `tests/unit/domain/scoring/persist-core.test.ts`:涵蓋 **override 無條件覆蓋(可低於 best)**、score=0 邊界、不在 problemIds 的 submission 被忽略、subtaskScores 對應。現有 `contest-scoring-race`/`exam-scoring-race` 測試是行為等價的回歸守門。
5. 跑 `pnpm test:unit`(scoring/\* + 兩個 race 測試全綠)+ `pnpm typecheck` + `pnpm lint`。

**明確 out-of-scope(寫進 PR 描述):** 合併 `updateXScores` 外層(FK query shape + 回傳值 + conflict class 不同)、抽 `updateWithVersion`/conflict class 泛型 helper(會犧牲 Prisma 型別安全)、`Submission` FK 多型化、修 migration `20260416180001` 的 `courseAssessmentId` vs schema `assessmentId` 欄名漂移(可單獨記 note,不在計分 PR 動 migration)。

**陷阱:** override 是**無條件 `.set` 覆蓋**(可低於 best),不是取 max——抽函式時必須保留此語意,否則悄改計分;現有 race 測試只跑 point_sum 單題、override=[],不會抓到 override 合併回歸,**新單測必須補 override case**。

**多型化 Submission FK 的衝擊面(屬風險 #1 後段,第一步 spike 不動)**:重寫 XOR CHECK、7 條複合 `@@index`、~90 檔 FK 引用、且 `contestParticipation`/`course`/`assessment` 是 `onDelete: SetNull` 而 `exam`/`contest`/`virtualContest` 是 `Cascade`——多型化會失去 DB 級 FK 級聯(**真正的功能性降級**,需 trigger/應用層補,風險最高)。應在純函式抽取站穩後另開獨立計劃。

- **不要被「四路統一」誘惑**:virtual-contest 讀時用 `buildScoreboard` 算不落地、assignment 用 Prisma `_max` aggregate,都不是同一 persist pattern。

### 風險 #2 — 自架 Temporal 拓撲 — ✅ 已決:維持自架(2026-06-11)

- **現狀:** 5 個 workflow 換來自架 Temporal Server + 專屬 Postgres StatefulSet + UI,維運是一人。
- **決策:** **維持自架**。已評估的替代(Temporal Cloud 外包運維 / 降級 pg-boss 級減依賴)不採;不寫程式、不改 infra(`infra/gcp/gke/temporal/*` 原封保留)。此項自此結案,非未決缺口。
- **若未來重啟:** 觸發點是維運負擔或成本變化,屆時再開獨立評估;現階段不行動。

### 風險 #3 — 把「組態正確性」系統化為可執行 fitness test

- **現狀:** 三次「全綠但壞掉」(bundle 註冊、seccomp、漏 migration)失效面都在「註冊/組態/基礎設施參數」層。已有局部對策:6.2 migrate-diff gate、7.3 activity-bundle 自動推導、8.x doc-drift gate。
- **方向:** 盤點所有「組態/註冊/infra-param」表面,為每個缺 fitness test 的補上「從單一真實來源自動推導 + 漂移即 fail」的測試。

#### 第一步 — ✅ 已盤點 + 補 fitness test + 修 3 個查實缺口(2026-06-11)

**組態/註冊表面清單(逐項標記)**:

| #   | 表面                                         | fitness test? | 落地處                                                                      |
| --- | -------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| 1   | activity bundle ↔ workflow proxyActivities   | ✅ 既有       | `tests/unit/worker/activity-bundle-registration.test.ts`                    |
| 2   | route-map ↔ FRONTEND.md                      | ✅ 既有       | `tests/unit/web/frontend-route-map.test.ts`                                 |
| 3   | schema ↔ migration ↔ DATABASE.generated      | ✅ 既有       | CI migrate-diff + db:docs diff gate                                         |
| 4   | **workflow 啟動字串名 / query 名 ↔ 註冊**    | ✅ **新增**   | **T1** `tests/unit/worker/workflow-registration.test.ts`                    |
| 5   | **worker env schema ↔ GKE manifest**         | ✅ **新增**   | **T2** `tests/unit/infra/env-manifest-parity.test.ts`                       |
| 6   | **seed TABLES ↔ schema models**              | ✅ **新增**   | **T5** `tests/unit/db/seed-tables-complete.test.ts`                         |
| 7   | sandbox 跨進程契約(worker plan ↔ runner Zod) | ✅ 已補       | **T3** `tests/unit/worker/sandbox-config-contract.test.ts`                  |
| 8   | K8s NetworkPolicy selector ↔ pod label       | ✅ 已補       | **T4** `tests/unit/infra/network-policy-parity.test.ts`                     |
| 9   | S3/raw-env(無 schema)                        | ✅ 已補       | **T6** storageEnvSchema prod fail-fast + `env-manifest-parity` 擴及 storage |

**盤點時查實並修復的 3 個缺口(本 PR 一併修)**:

- **缺口 A【prod 開機即死,已修】** `apps/worker/src/env.ts` 的 `SANDBOX_CPU_LIMIT`/`MEMORY_MB`/`PIDS_LIMIT`/`WORKER_CONCURRENCY` 為 required-no-default,但 GKE `worker.deployment.yaml` 四個全缺、kustomization 無注入 → `parseWorkerEnv` 開機 throw → crashloop。**修法(已採)**:3 個 docker-only 的 `SANDBOX_*` 移到 `dockerEnvSchema`(k8s 不再要求死 env)、`WORKER_CONCURRENCY` 留 base 並加進 manifest;`DEPLOYMENT.md` 原謊報「有 default」一併更正;**T2 即此缺口的防復發守衛**。
- **缺口 B【邏輯漂移,已修】** `execution-backend.ts` 直讀 `$env` 的 `EXECUTION_BACKEND`(不在 webEnvSchema、cloudrun 未設)→ k8s 後端時 `isAdvancedModeSupported()` 誤回 true。**修法**:納入 `webEnvSchema`(default `docker`)、改走 `getWebEnv()`、`web.cloudrun.yaml` 設 `kubernetes` 對齊 worker。
- **缺口 C【現況靠 CASCADE 僥倖,已修】** seed-test-db `TABLES` 漏 15 個 model(見 2.2 / T5)。

**T3 / T4 / T6 — ✅ 全部補完(2026-06-11 第二輪)**:

- **T3 ✅** `tests/unit/worker/sandbox-config-contract.test.ts`:對 5 種代表 request(standard/checker/interactive/multi_file+entryFile+sourceFileMap/special_env)斷言 `SandboxInputSchema.safeParse(buildSandboxConfigJson(...)).success`,並逐欄檢查 producer→schema rename 不會默默掉欄。
- **T4 ✅** `tests/unit/infra/network-policy-parity.test.ts`:解析 `network-policy.yaml` 的 `matchLabels` 與 k8s-executor 所有 `labels:{...}` 區塊,斷言每個 pod label set ⊇ deny-all selector(漂移=沙箱可達網路)。
- **T6 ✅** `storageEnvSchema` 加 `NODE_ENV` + prod-required `superRefine`(`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` 缺即 fail);worker `index.ts` boot 顯式 `getStorageEnv()` fail-fast;`env-manifest-parity.test.ts` 擴及 storage——drop-one 推導 prod-required 鍵 ⊆ **GKE worker + web Cloud Run 兩個 manifest**。**盤點時查實:`web.cloudrun.yaml` 也缺 S3 env**(web 用 storage 做題目圖/avatar,同 #129 worker 缺口)→ 一併補上,parity test 即兩者的防回歸守衛。

---

## 驗證

- Phase 1/2 每 task 跑對應層 typecheck/unit/integration;Phase 1 的 harness 須在 CI 實跑。
- Phase 3 各風險在獨立計劃內驗證;本計劃只到「第一步 spike/決策 doc」。
