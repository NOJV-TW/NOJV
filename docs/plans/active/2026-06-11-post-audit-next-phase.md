# 稽核後下一階段 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: 實作時用 superpowers:executing-plans 逐 task 進行。

**Goal:** 收尾 2026-06-10 全 codebase 稽核**修復後仍未做**的工作——分三類:(A) 需要測試基建才能補的測試、(B) 可直接做但先前遞延的測試品質項、(C) 首席架構師三個結構性風險(需設計決策、各自規模大)。

**Context:** 稽核缺陷修復已完成並驗證,見 [`docs/plans/completed/2026-06-10-audit-remediation.md`](../completed/2026-06-10-audit-remediation.md)(含附錄 D 對抗式驗證結果)。本計劃只涵蓋**那份計劃刻意未做、或查證後判定需另開計劃**的剩餘項。

**Tech Stack:** SvelteKit + better-auth + Temporal + Prisma 7 + Redis + Vitest。

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

### Task 1.1: 建 in-process SvelteKit handler 測試 harness

- 評估方案:(a) `@sveltejs/kit` 的 `Server` + `installPolyfills` 在 vitest 內建一個可 `server.respond(new Request(...))` 的實例;(b) 直接對 build 後的 node adapter server 起一個 ephemeral port 跑 supertest 式請求(較重但最真實);(c) 為 `$env/dynamic/private` 提供 vitest mock,讓 `auth.server.ts`/route handler 可被 import。
- 產出:一個 `tests/integration/http/` 套件 + 共用 harness fixture,能對 `+server.ts` 與經過 `hooks.server.ts` 守衛鏈的請求發測試。
- 驗收:harness 能成功對一個既有 GET endpoint 發請求並斷言狀態碼/body。

### Task 1.2: 補 1.1 — 公開註冊停用端點測試

- `POST /api/auth/sign-up/email` → 4xx;`POST /api/auth/sign-in/email` 對 seeded 帳號 → 200。
- 驗收:測試在 CI 跑,改回 `disableSignUp:false` 會讓測試紅。

### Task 1.3: 補 6.6 — 守衛鏈 request 層邊界測試

- 涵蓋 hooks 守衛鏈關鍵分支:未登入存取 `(app)` → redirect /signin;`mustChangePassword` → redirect 改密頁;admin 未開 2FA 進 `/admin/**` → redirect 2FA 設定;exam IP gate 對 `/api` 的擋法。
- 驗收:每條守衛各至少一個 request 層測試。

---

## Phase 2 — 可直接做的測試品質項(6.6 殘留,無基建阻礙)

### Task 2.1: editorials e2e 去硬 sleep

- `tests/e2e/editorials.test.ts:53` 的硬 `sleep(1.5s)` + 鏈式相依改 wait-for 條件;前置失敗不再 silent skip(改 explicit assertion/fixture)。

### Task 2.2: `truncateAllTables` 自動推導 / 漂移防護

- `tests/fixtures/seed-test-db.ts` 的手動 TABLES 清單改從 Prisma DMMF 或 `information_schema` 自動推導;或加一個「漏列即 fail」的漂移防護測試(對齊 7.3 activity-bundle、8.x doc-drift 的 fitness 模式)。

### Task 2.3: workflow 分支 `@temporalio/testing` 測試

- 用 `@temporalio/testing` 的 TestWorkflowEnvironment 對 submission-judge workflow 的分支(contest vs exam vs practice、rejudge 取消、sweeper)寫可執行測試。涵蓋 3.1 計劃原本要的「single child reject 不影響其餘」與 contest/exam 分支。

### Task 2.4: CI 沙箱 image build + 隔離回歸(nightly)

- `.github/workflows/` 加 nightly job:build sandbox image + 跑沙箱隔離回歸(seccomp/cap-drop/記憶體 fork);標註 nightly 不阻塞 PR。

---

## Phase 3 — 結構性風險(首席架構師三項;各需獨立設計計劃)

> 這三項是**設計級**決策,規模遠超補丁;本計劃只列方向與第一步,實作前應各自開獨立設計計劃(brainstorming → design doc → implementation plan)。

### 風險 #1 — Contest / Exam / Assessment 三胞胎模型收斂

- **現狀痛點:** `Submission` 扛 `contestId`/`examId`/`assessmentId`/`virtualContestId` 多個 nullable context FK + XOR CHECK;`contest/scoring.ts` 與 `exam/scoring.ts` 近乎逐函式同構;persist-score 編排層複製(正是已出貨 P1「exam 判題沒呼叫 updateExamScores」的案發現場)。Wave R 的命名統一只是表面第一步。
- **方向:** 收斂成多態 timed-assessment 實體,或至少把 persist-best-score 編排層收成單一實作 + 薄 adapter。
- **第一步 spike:** 比對 `persistContestBestScore` / `persistContestProblemCountScore` 與 exam 對應函式,抽出可共用的純計分核心 + 各自的 context adapter;評估 `Submission` 多型 FK 的 migration 成本。

### 風險 #2 — 自架 Temporal 拓撲

- **現狀:** 5 個 workflow 換來自架 Temporal Server + 專屬 Postgres StatefulSet + UI,維運是一人。
- **方向(需決策):** Temporal Cloud(保留程式模型、外包運維)vs 降級為 pg-boss 級方案(減依賴)vs 維持自架。
- **第一步:** 寫一份 cost + ops + 風險比較 doc,讓你/團隊拍板;在決策前不動程式。

### 風險 #3 — 把「組態正確性」系統化為可執行 fitness test

- **現狀:** 三次「全綠但壞掉」(bundle 註冊、seccomp、漏 migration)失效面都在「註冊/組態/基礎設施參數」層。已有局部對策:6.2 migrate-diff gate、7.3 activity-bundle 自動推導、8.x doc-drift gate。
- **方向:** 盤點所有「組態/註冊/infra-param」表面(activity bundles、env schema、seccomp profile、K8s manifest 參數、queue 對應、seed TABLES 清單…),為每個缺 fitness test 的補上「從單一真實來源自動推導 + 漂移即 fail」的測試。
- **第一步:** 列出組態表面清單 + 標記哪些已有 fitness test、哪些沒有。

---

## 驗證

- Phase 1/2 每 task 跑對應層 typecheck/unit/integration;Phase 1 的 harness 須在 CI 實跑。
- Phase 3 各風險在獨立計劃內驗證;本計劃只到「第一步 spike/決策 doc」。
