# 全 Codebase 稽核修復 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修復 2026-06-10 多代理稽核(94 agents、8 維度 + 對抗式查證)確認的全部 P1/P2/P3 缺陷與文件漂移,一律往最佳實踐實作,不考慮向下相容與重構成本。

**Architecture:** 分 9 個 wave,每 wave 一個關注面、可獨立 commit + 驗證。高風險、互相耦合的判題管線與 auth 改動由本人序列實作(避免「全綠但壞掉」),低耦合的 docs/infra 可平行。每 wave 跑對應層的 typecheck/unit/integration。

**Tech Stack:** SvelteKit + better-auth(含 twoFactor plugin)、Temporal、Prisma 7、Redis、Zod 4、Vitest。

**已定案的設計決策(使用者裁示):**

- **Auth:** `disableSignUp: true`(全環境;登入保留,只關公開註冊端點)。
- **Admin 模型:** 專屬 admin 帳號(非 OAuth 白名單)——乾淨特權分離,沿用既有 `/admin-signin` 入口。
- **Admin 硬化:** 首登強制改密(env bootstrap 密碼為一次性)+ TOTP 2FA(better-auth `twoFactor` plugin)。
- **Seed:** 拆出 `db:bootstrap-admin`(prod 專用,身分/密碼全來自 env,缺值或 <12 字元即 fail,只在 create 設、永不覆寫);demo seed 維持 `password123` 測試帳號但 `NODE_ENV=production` 硬擋,account upsert `update: {}` 不再重設密碼。**讀任何原始碼/SQL 都得不到 prod admin 密碼。**

---

## Wave 1 — Auth & Admin 硬化(security P1 + gap P1/P2)

**目標:關閉公開註冊、prod admin 密碼脫離原始碼、首登強制改密、TOTP 2FA。**

### Task 1.1: disableSignUp

- Modify: `apps/web/src/lib/auth.server.ts:97-103`
- 在 `emailAndPassword` 加 `disableSignUp: true`。登入端點不受影響。
- Test: `tests/integration/api/auth-signup-disabled.test.ts` — `POST /api/auth/sign-up/email` 回 4xx;`POST /api/auth/sign-in/email` 對 seeded 帳號回 200。

### Task 1.2: env schema 擴充

- Modify: `apps/web` 的 web env schema(`getWebEnv` 來源,grep `BETTER_AUTH_SECRET` 定位)
- 加:`SEED_ADMIN_USERNAME`、`SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD`(皆 optional,bootstrap 腳本自行驗 prod 必填)。
- packages/db seed env:同樣讀這三個 + `ALLOW_PROD_SEED`(demo seed guard 用)。

### Task 1.3: 拆 `db:bootstrap-admin`

- Create: `packages/db/prisma/bootstrap-admin.ts`
- 讀 `SEED_ADMIN_{USERNAME,EMAIL,PASSWORD}`;`NODE_ENV=production` 時三者必填且密碼 >=12 字元,否則 `throw`。
- upsert admin user(platformRole=admin)+ credential account,`update: {}`(永不覆寫密碼);新增 `mustChangePassword: true` 旗標(見 1.5)。
- Modify: `packages/db/package.json` 加 `"bootstrap-admin"` script。
- Modify: `.github/workflows/deploy.yml` — prod 部署改跑 `db:bootstrap-admin`(取代對 prod 跑 demo seed 的路徑);demo seed 僅 `DEPLOY_WITH_SEED=true` 的 staging。

### Task 1.4: demo seed 收緊

- Modify: `packages/db/prisma/seeds/users.ts:6,78`
- account upsert `update: { password }` → `update: {}`。
- Modify: seed 進入點(`packages/db/prisma/seed.ts`)— `NODE_ENV=production && !ALLOW_PROD_SEED` 時 `throw`(demo 的 password123/破壞性 deleteMany 不得進 prod)。

### Task 1.5: 首登強制改密

- Schema: `packages/db/prisma/schema/auth.prisma` 的 User 加 `mustChangePassword Boolean @default(false)`;migration。
- better-auth additionalField 暴露 `mustChangePassword`。
- hooks: `apps/web/src/hooks.server.ts` 守衛鏈加一關 — 已登入且 `mustChangePassword` 時,除 `/account/change-password` 與登出外一律 redirect 至改密頁。
- Route: `apps/web/src/routes/(app)/account/change-password/+page.{svelte,server.ts}` — 走 better-auth change-password,成功後清 `mustChangePassword`。

### Task 1.6: TOTP 2FA

- Modify: `apps/web/src/lib/auth.server.ts` plugins 加 `twoFactor()`;`apps/web/src/lib/auth.client.ts` 加 `twoFactorClient()`。
- Schema:better-auth twoFactor 需要的表(`twoFactor`/backup codes)— 跑 better-auth migration 或手寫對應 Prisma model + migration。
- Routes:`/account/two-factor`(設定/顯示 QR/驗證/recovery codes)、登入流程的 2FA 挑戰頁。
- 強制策略:admin 帳號未啟用 2FA 時,hooks 在進入 `/admin/**` 前 redirect 至 2FA 設定(可與 1.5 同一守衛)。

**Wave 1 驗證:** `pnpm --filter @nojv/web check`、相關 integration 測試、`pnpm db:generate`。

---

## Wave 2 — 判題管線正確性(judge P1,本人序列實作 + TDD)

### Task 2.1: SE verdict 語意修正

- Modify: `packages/core/src/types.ts:29-36` — `submissionVerdicts` 加 `"system_error"`。
- Modify: `packages/domain/src/submission/scoring.ts:22-28` — `verdictMap.SE = "system_error"`;`mapResult` 在跑分前**優先**偵測任何 case `verdict === "SE"`,有則回 `{ verdict: "system_error", accepted: false, score: 0, feedback: 平台故障訊息 }`,不進跑分/不扣次數。
- Modify: VerdictBadge 元件(grep `verdictMap`/`VerdictBadge`)加 system_error 色(用 `--warning` 之類 token,非 destructive,以區別學生錯誤)。
- Test: `tests/unit/domain/scoring-system-error.test.ts` — 單一 case SE → 最終 verdict system_error、score 0;`tests/unit` 既有 attempt-count 測試確認 system_error 不計次數(MEMORY:所有 system_error 返還)。

### Task 2.2: 大輸出截斷對齊(消除 ZodError 卡死)

- 統一上限策略:在「進入 `submissionResultSchema.parse` 之前」對每 case stdout/stderr、compile error、feedback 做**截斷**(附 `…[truncated]` 標記),保證永不超過 core schema 上限。
- Modify: `apps/worker/src/activities/judge.ts:~252`(parse 前截斷)+ `packages/domain/src/submission/scoring.ts` `mapResult`(填 caseResults 時截斷)。
- Modify: `apps/worker/src/services/standard-mode-executor.ts:275-289` — runner→worker 16MB 整體 cap 與每 case 上限對齊,截斷而非整筆轉 SE。
- Test: `tests/unit/worker` 或 domain — 餵 >1MB stdout 的 case,確認不 throw 且 verdict 正常(非 system_error)、stdout 被截斷。

### Task 2.3: PROPORTIONAL/MINIMUM 部分給分保留

- Modify: `packages/core/src/schemas/submission.ts:81-87` — `subtaskResultItemSchema` 加 `rawScore`(目前被 Zod strip)。
- Modify: domain `mapResult` / `buildSubtaskResults` — 把 rawScore 帶進輸出 schema。
- Modify: VerdictSummary / UI subtask 顯示 — 用 rawScore 顯示部分分數,不再二值化。
- Test: PROPORTIONAL 策略 3/5 case 過 → subtask 顯示比例分而非 0。

### Task 2.4: 記憶體判定涵蓋子行程

- Modify: `apps/sandbox-runner/src/utils.ts:21-51` — 改用 cgroup memory peak(`memory.peak` / `memory.max_usage_in_bytes`)而非單一 PID VmHWM,涵蓋 fork 子行程。
- Test: 實機(sandbox image)— fork 後大量配置記憶體應觸 MLE。標註此測試需 sandbox image(見 Wave 6 CI)。

**Wave 2 驗證:** `pnpm --filter @nojv/core build`、`pnpm --filter @nojv/domain test`、typecheck。

---

## Wave 3 — 判題基礎設施 + 物件授權(judge P1/P2 + backend P1)

### Task 3.1: 批次 rejudge 錯誤隔離

- Modify: `apps/worker/src/workflows/rejudge.ts:31-42` — 把 `Promise.all` 改為 `Promise.allSettled`(或逐 child try/catch),單一 child 失敗不炸父 workflow、不 TERMINATE 其他 in-flight children;改 `parentClosePolicy=ABANDON`(child 自行完成),失敗的 child 個別記錄。
- Test: workflow 單元(@temporalio/testing 或純邏輯抽出測)— 一個 child reject 不影響其餘。

### Task 3.2: K8s Job deadline 讀 judgeConfig + ConfigMap 上限檢查

- Modify: `apps/worker/src/services/k8s-executor.ts:37` — `activeDeadlineSeconds` 由 judgeConfig(每 case timeout × case 數 + 緩衝)算出,非寫死 120;testcase 注入前檢查 ConfigMap < 1MiB,超過改用 volume/S3 掛載或 fail loud。
- Test:單元(k8s-executor 的 deadline 計算純函式抽出)。

### Task 3.3: sources-missing 路徑一致

- Modify: `apps/worker/src/activities/judge.ts:167-177` — 標 system_error 後不要讓 completeJudge 覆寫回 runtime_error(early return 或讓 result.verdict=system_error)。
- Test:sources missing → 最終 status system_error。

### Task 3.4: testcase 物件層級授權

- Modify: `packages/domain/src/problem/testcase.ts:115`(四個變更函式)— 以 `setId`/`testcaseId` 操作前,先驗證該 set/testcase 屬於路由 `problemId`(repo 查 + 比對,不符則 NotFoundError/Forbidden)。
- Test: `tests/integration` — A 題作者帶 B 題的 setId → 403/404,不得刪改。

**Wave 3 驗證:** worker typecheck、domain test、相關 integration。

---

## Wave 4 — Web 層(web P2/P3 + security P2)

### Task 4.1: contest/exam 設定表單 schema 統一(消 500)

- Modify: `apps/web/src/routes/(app)/contests/[contestId]/+page.server.ts:203` 及 exam 對應 — update schema 的 `.parse()` 移進 try、或讓 form schema 與 update schema 同源(同一 core schema),使短標題在驗證層被擋成 fail() 而非未捕捉 ZodError 500。
- Modify: 將 `examFormSchema`(route-local)移至 `@nojv/core`,與 assignment 對齊。
- Test:短標題提交 → 回 form error,非 500。

### Task 4.2: SSE slot 洩漏

- Modify: `apps/web/src/routes/api/events/stream/+server.ts:79` — `acquireSseSlot` 之後到 stream 建立之間的 await 用 try/finally 包,失敗即釋放 slot;slot Map 加 TTL/上限(見 Wave 5 連線共享)。
- Test:模擬 acquire 後 await throw → slot 已釋放。

### Task 4.3: worker readyz/healthz 真實反映 Temporal

- Modify: `apps/worker/src/worker-app.ts:32` — readyz/healthz 主動 ping Temporal(client `connection.healthCheck()` 或 describeNamespace),非僅看 Worker getState。
- Test:單元 mock 連線失敗 → readyz 回 false。

### Task 4.4: /api/healthz 限流 + 用 Temporal 探測結果

- Modify: `apps/web/src/routes/api/healthz/+server.ts:5` — 加快取(短 TTL)/rate limit;Temporal 探測結果納入回應(目前被丟棄);避免每次開 DB transaction。

### Task 4.5: SSE 客戶端死碼 backoff 修復

- Modify: `apps/web/src/lib/stores/sse.ts:59` — `onerror` 不再先 `disconnectSSE()` 歸零 `reconnectAttempts`;真正套用指數退避與上限。

### Task 4.6: 其餘 web P3

- form action 錯誤處理統一(`exams/[examId]/+page.server.ts:336` 等 → 走 shared handler 的錯誤翻譯)。
- 三胞胎 detail load 的 plagiarism/flags/clarification 序列化抽共用 helper(`exams|assignments|contests/[id]/+page.server.ts`)。
- `exams/[examId]/+page.svelte` 738 行:tab 改 array-driven、inline-SVG checklist 抽元件;`exams/new` 手刻 toggle 改用既有元件。
- server action 使用者可見訊息走 paraglide i18n(`contests/new/+page.server.ts:49` 等)。
- `lib/utils/datetime.ts:94` 重複實作合一。
- `problems/[problemId]/edit/+page.server.ts:72` 偽造 RequestEvent → 用正規 loader auth helper。

**Wave 4 驗證:** `pnpm --filter @nojv/web check`、lint。

---

## Wave 5 — 效能(perf P2/P3)

### Task 5.1: 記分板 — Redis ZSET 決策

- 決策:**讓讀路徑消費既有 ZSET**(否則拆掉死寫入)。推薦接讀:`contest/exam` 的 `getScoreboard` 改先讀 Redis ZSET,miss/frozen 才從 PG 重算並回填。
- Modify: `packages/domain/src/contest/scoring.ts:232`、`packages/redis/src/scoreboard.ts`、前端 30s `invalidateAll` 改 SSE/針對性更新。
- 同一請求重算兩次 → 算一次共用。

### Task 5.2: submission stream 改用 pub/sub

- Modify: `apps/web/src/routes/api/submissions/[id]/stream/+server.ts:25` — 用既有 verdict pub/sub 推送,移除 1Hz Temporal workflow query(消除考試尖峰 query task 與判題搶 worker 槽)。

### Task 5.3: 索引補齊(migration)

- `packages/db/prisma/schema/submission.prisma` 加 `@@index([courseAssessmentId, createdAt])`(目前只有複合次欄位)。
- 題目全文搜尋 GIN expression index(`packages/db/src/repositories/problem.ts:167`);加後零結果 fallback ILIKE 邏輯檢視。
- migration + `pnpm db:generate`。

### Task 5.4: acceptance rate 快取 / exam session 批次

- `submission.ts:238` 的 `COUNT(DISTINCT userId)` 加快取或覆蓋索引。
- `exam/session.ts:196` 批次關閉改 `updateMany`/批次 insert,減少持鎖序列 round trip。

**Wave 5 驗證:** integration(真打 PG)、migration apply dev。

---

## Wave 6 — Infra / CI / Deploy(gap P1/P2 + testing P1/P2)

### Task 6.1: compose prod S3 佈線

- Modify: `docker-compose.yml` prod web(133)/worker(171)environment 加 `S3_*` passthrough、`depends_on` 加 minio、啟動清單含 minio;`deploy.yml` preflight 轉發 `S3_*` 到 GITHUB_ENV。
- 驗證:部署後 healthcheck 應能收提交(Wave 6.5)。

### Task 6.2: CI migration drift gate

- Modify: `.github/workflows/ci.yml` 加步驟 `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code`;另對乾淨 DB 跑 `prisma migrate deploy` 驗整條鏈可執行。

### Task 6.3: restart policy

- Modify: `docker-compose.yml` web/worker 加 `restart: unless-stopped`。

### Task 6.4: Grafana OTel 佈線

- Modify: `docker-compose.yml` prod 加 `GRAFANA_OTLP_*` passthrough(`${VAR:-}`);`apps/worker/src/otel.ts:11-14` + `apps/web/src/lib/server/otel.ts` 缺值時 `NODE_ENV=production` `console.warn` 一行(非靜默)。

### Task 6.5: 自架備份

- Create: `infra/` pg_dump cron(compose sidecar 或 runner cron 範本);`docs/runbooks/backup-restore.md` 補 self-hosted 章節。

### Task 6.6: CI 沙箱 + workflow 測試訊號

- `.github/workflows/ci.yml` 加 sandbox image build + 跑沙箱隔離回歸測試(可 nightly job);submission-judge workflow 分支邏輯加可執行測試(@temporalio/testing)。
- 移除 CI 重複跑同一 unit suite(`ci.yml:71-77`)。

### Task 6.7: compose 周界

- `docker-compose.yml` postgres/redis/minio/temporal/temporal-ui host port 綁 `127.0.0.1:`;prod 不啟 temporal-ui 或加認證;DB/Redis 憑證改 env 注入非硬編。
- 同步 `docs/operations/THREAT_MODEL.md:314`。

### Task 6.8: coverage gate

- `vitest.config.ts:20-37` coverage threshold:接上 CI 執行,或拆掉(從不執行的門檻比沒有更糟)。

**Wave 6 驗證:** `act` 或 dry-run CI yaml lint;compose config validate。

---

## Wave 7 — 架構 / 後端清理(arch P2/P3 + backend P3)

### Task 7.1: ESLint 分層守衛補洞

- Modify: `apps/web/eslint.config.mjs:12` — 禁止 `.svelte` 元件 value-import `@nojv/domain`(只允 type-import);`packages/db` 加 import 守衛(禁 src→redis/storage,seed 例外)。

### Task 7.2: repository 邊界收斂

- `packages/db/src/index.ts:5` 不再匯出整個 Prisma value namespace;domain 13 處 raw `tx.model.*`(`course/members.ts`、`proctoring/gate.ts` 等)改走 repository 的 withTx 方法。
- `runTransaction` 不洩漏 `Prisma.TransactionClient` 形狀給 domain。

### Task 7.3: activity-bundle fitness test 自動推導

- Modify: `tests/unit/worker/activity-bundle-registration.test.ts:10` — workflow 清單從 `workflows/index.ts` 自動推導,而非手工陣列(防 sweeper 那類漏列)。

### Task 7.4: 其餘

- `packages/redis/src/keys.ts` pub/sub channel 加 `nojv:` 前綴對齊。
- `packages/core/src/queue.ts` 三種關注點拆檔。
- 4 份 storage client 單例合一(可測 hook)。
- repo `withTx` 區塊 template 去重。
- `course/members.ts:149` 權限讀寫包同一交易(消 TOCTOU)。
- `SubmissionRejudgeLog` old/newResultJson 改存 verdictSummary 摘要(或 S3 key),不存整份 detail;reaper 掛點加保留期清理。

**Wave 7 驗證:** 全 repo typecheck、lint、unit。

---

## Wave 8 — 文件同步(docs P2/P3)

- `docs/plans/active/` 5 個已 shipped 計劃移 `completed/`。
- `docs/operations/RELIABILITY.md:103` 移除幽靈 `assessmentLifecycleWorkflow`、`PlagiarismReport`。
- `docs/product/PRODUCT_SENSE.md:147` Non-Goals 三項(已 shipped)更新;建題權限改「驗證學生」。
- `docs/architecture/ARCHITECTURE.md:216,251` redis cache/cooldown 移除、workflow 表補 sweeper、rejudge workflowId 改 UUID。
- `docs/architecture/JUDGE_PIPELINE.md:67` 四處與程式相反處改正(K8s interactive、MINIMUM、bounded-buffer、judgeSandbox proxy)。
- `docs/specs/assignments.md:54` attempt-limit 改 per-problem + 台北重置時刻;補 rejudge/stale reaper spec。
- `docs/architecture/DATABASE.md:293` 移除 UserDailyActivity、補新表;重生 DATABASE.generated.md。
- `docs/architecture/FRONTEND.md:74` route map 補 12 endpoint + /admin/rejudges。
- `README.md:9` 移除虛構功能(join tokens、network access 等);CLAUDE.md/README temporal 描述對齊。
- `docs/operations/QUALITY_SCORE.md:19` 測試數據更新、里程碑補 2026-06。

---

## Wave 9 — 全域驗證 + 收尾

- `pnpm ci:verify`(format/lint/db:generate/build/typecheck/unit)。
- `pnpm test:integration`(真打 PG/Redis)。
- `pnpm test:e2e`(本機,sandbox image)。
- 移除本計劃中 wave 已完成項對應的 QUALITY_SCORE Outstanding Drift;本計劃移至 `completed/`。
