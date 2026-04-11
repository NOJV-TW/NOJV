# Codebase Cleanup Audit

- **Date:** 2026-04-12
- **Scope:** 全 repo 程式碼健康度審查，產出分階段清理計畫
- **Decision type:** Audit + execution plan（尚未實作）
- **Status:** Ready for plan phase

## 1. 背景與目標

NOJV 目前共 ~1,225 個非 generated 原始檔（TS/Svelte，~44k 行）。專案正要進入正式上線前的整頓期。本次 audit 的目標：

1. 找出過大 / 職責糊 / 應該被拆的檔案
2. 找出 silent failure、冗餘 fallback、過度防禦
3. 確認型別系統與 Zod 覆蓋度
4. 清理死碼、無用檔案、失效文件與 config
5. 產出可直接排 PR 的分階段清理計畫

本文件是 audit 的交付物。實作本身不在此 spec 範圍內——之後每個 P0/P1 條目由對應的 implementation plan 接手。

### 非目標

- 不引入新功能、不做風格重構（例如命名風格統一）
- 不動 generated code（`packages/db/generated/`）
- 不動 test fixture、seed 資料，除非它們本身就是死碼
- 不做 perf 優化
- `docs/CP-problem/` **保留**（為未來題目設計素材，不屬於本次清理範圍）

## 2. 總體體檢結果

| 面向           | 評價 | 說明                                                                    |
| -------------- | ---- | ----------------------------------------------------------------------- |
| 型別系統逃生艙 | 優   | 全 repo `as any` = 0、`@ts-ignore` = 0、`as unknown as` = 2（都可解釋） |
| Zod 覆蓋       | 優   | form actions / API routes / Temporal activities 邊界都有驗證            |
| 死碼           | 優   | 只找到 1 個完全空的模組                                                 |
| 註解品質       | 良   | 整體是 WHY 導向，沒有明顯腐爛 TODO                                      |
| 檔案職責       | 中   | 幾個前端元件 + domain 層 mutation 檔過大 / 混雜                         |
| 防禦性編碼     | 中   | 有幾處 safeParse → 合成假資料 的 silent failure 需要改                  |
| 文件           | 良   | 15 份核心 docs 健康，`JUDGE_PIPELINE.md` 有少量 future-tense 需要標示   |
| 根目錄衛生     | 差   | `.gitignore` 漏 `.tmp/` 和 `.shared/`、`.prettierignore` 有失效路徑     |

結論：**整體健康度高，真正的債集中在「幾個大檔案的職責糊」+ 「少數 silent failure」**。不需要全面重構，只需要手術刀式清理。

## 3. 發現清單

### P0 — 純清理與安全修正（低風險）

#### P0-1 刪除空的 `user-stats.ts` 模組

- **路徑：** `packages/core/src/user-stats.ts`
- **現況：** 整個檔案只有 `export {};`
- **動作：** 刪檔 + 從 `packages/core/src/index.ts` 移除 `export * from "./user-stats";`
- **風險：** 0

#### P0-2 `.gitignore` 補兩條

- **現況：** `.tmp/` 與 `.shared/` 實際存在但未被 ignore
- **動作：** 追加兩行，並刪除 `.shared/ui-ux-pro-max/`（388KB，舊設計素材，使用者已確認可刪）
- **風險：** 0

#### P0-3 `.prettierignore` 移除失效路徑

- **現況：** 列出 `apps/workspace/dist`、`apps/web/src/paraglide`、`apps/web/project.inlang`、`apps/web/src/lib/paraglide`——這些目錄都不存在
- **動作：** 刪除失效行
- **風險：** 0

#### P0-4 修正 `JUDGE_PIPELINE.md` 的 future-tense 段落

- **現況：** 文件提到 `minimum` scoring strategy 為「reserved for future」，但實際 sandbox runner 不支援
- **動作：** 刪除該段或明確標示「尚未實作」
- **風險：** 0

#### P0-6 CLAUDE.md 加入 Doc Index by Task

- **路徑：** `CLAUDE.md`
- **現況：** 只有線性的 Reading Order（onboarding 用），沒有任務導向的文件索引，agent 在做特定工作時必須把 15 份 docs 全掃才找得到相關那份
- **動作：** 新增 `Doc Index by Task` 表格（工作主題 → 對應 doc）與 `Doc Authoring Rules`（避免未來文件疊床架屋）
- **狀態：** ✅ 已完成於本輪 audit；列在此處作為 audit trail
- **風險：** 0

#### P0-5 修正 submission queries 的 silent failure

- **路徑：** `packages/domain/src/submission/queries.ts:58-85`（`listProblemSubmissions` 內的 map）
- **現況：**
  - Line 60：`verdictParsed.success ? verdictParsed.data : "wrong_answer"`——Zod 失敗時靜默降級成 `wrong_answer`
  - Line 65-75：`submissionResultSchema.safeParse(s.verdictDetail)` 失敗時合成假的 `SubmissionResult`
  - Line 81：`languageSchema.safeParse(s.language)` 失敗時把原始字串吐回去，後續會爆型別
- **為何嚴重：** 這個 query 只撈 `statusIn: [...submissionVerdicts]` 的紀錄，表示 status 一定是合法列舉。若 schema parse 失敗，代表 DB 資料損壞。用 fallback 合成假資料會讓破損靜默地顯示錯誤 verdict 給學生。
- **動作：** 全部改成 `parse()` 直接 throw；在呼叫端（router / load function）由 ErrorBoundary 接住
- **風險：** 低——使用者已確認上線前會全面重新 seed，不需 data migration；staging 跑 e2e 即可

### P1 — 架構層級重構（中風險，每項獨立 PR）

#### P1-1 抽共用 `ProblemLeftPanel` 元件

- **路徑：**
  - `apps/web/src/lib/components/problem/Workspace.svelte` (567 行)
  - `apps/web/src/lib/components/problem/advanced/AdvancedModeWorkspace.svelte` (901 行)
- **現況：** `AdvancedModeWorkspace.svelte` 自己在註解寫「mirrors Workspace.svelte left-pane shape」——左側 panel（description / submissions / editorials 三 tab）幾乎完全重複
- **動作：**
  - 抽出 `apps/web/src/lib/components/problem/ProblemLeftPanel.svelte`
  - 兩個 workspace 各自透過組合使用
- **預期成效：** 合計減少 ~300-400 行重複碼
- **風險：** 中——需小心 slot / prop 介面設計；需 visual regression 測試

#### P1-2 拆解 `Editor.svelte`

- **路徑：** `apps/web/src/lib/components/problem/Editor.svelte` (853 行)
- **現況：** 同時管 Monaco lifecycle、語言選擇、workspace files、submission 執行 + polling、底部 panel、resize
- **動作：** 拆成
  - `EditorCore.svelte`（Monaco instance、theme、draft persistence）
  - `LanguageSelector.svelte`（語言過濾）
  - `WorkspaceFilePanel.svelte`（檔案樹、選擇）
  - `EditorBottomPanel.svelte`（testcase / result tabs）
  - `$lib/services/submission-service.ts`（executeSubmission + polling；為 AdvancedMode 與一般 workspace 共用）
- **相依：** 建議在 P1-1 之後做，避免 merge conflict
- **風險：** 中

#### P1-3 拆解 `packages/domain/src/problem/mutations.ts`

- **路徑：** `packages/domain/src/problem/mutations.ts` (533 行，15 exports)
- **現況：** CRUD + workspace files + testcase sets + mode conversion 全擠在一起；內含 5 個其實是查詢的 helper（`requireProblem`、`assertProblemOwnership`…）
- **動作：** 拆成
  - `problem-crud.ts`
  - `workspace-mutations.ts`
  - `testcase-mutations.ts`
  - `problem-conversion.ts`
  - 將純查詢 helper 搬到 `problem/queries.ts` 或新的 `problem/helpers.ts`
- **風險：** 中——需更新 import path，但 type 系統會抓到所有錯誤

#### P1-4 拆解 `contest/scoreboard.ts`

- **路徑：** `packages/domain/src/contest/scoreboard.ts` (453 行)
- **現況：** `getScoreboard` 主流程與 ICPC / IOI 兩套 scoring strategy 混在同檔
- **動作：**
  - `scoreboard-builder.ts`（`getScoreboard` + 權限 + freeze）
  - `icpc-scoring.ts`
  - `ioi-scoring.ts`
  - `rank-util.ts`（`assignRanks`、`groupByUser`）
- **風險：** 低——純函式，unit test 覆蓋後即可

#### P1-5 拆解 `docker-executor.ts`

- **路徑：** `apps/worker/src/services/docker-executor.ts` (578 行)
- **現況：** 混 standard 容器 orchestration、advanced tarball + image load、sandbox 結果 mapping
- **動作：**
  - `standard-mode-executor.ts`
  - `advanced-mode-executor.ts`
  - `sandbox-result-mapper.ts`
- **風險：** 中——需配合 sandbox-runner 整合測試驗證

#### P1-6 將 Temporal judge 的 scoring 邏輯搬到 `@nojv/domain`

- **路徑：** `packages/temporal/src/activities/judge.ts` (438 行)
- **現況：** `buildSubtaskResults` / `verdictMap` 等 ~200 行 scoring 邏輯住在 Temporal activity，導致 sandbox-runner 測試必須重複實作
- **動作：** 搬到 `@nojv/domain/src/submission/scoring.ts`，兩端都 import
- **風險：** 低

### P2 — 局部清理（小 PR 可收）

#### P2-1 刪除 `judge-context.ts` 的冗餘 nullable fallback

- **路徑：** `packages/domain/src/submission/judge-context.ts`
- **動作：** 刪除 `?? null` / `?? undefined` 在欄位型別已是 nullable 時的包裝（line 86, 96, 114, 118, 153 附近）
- **風險：** 低——型別檢查會抓到任何破綻

#### P2-2 壓平 `pick-problem-statement.ts` 三層 `??` fallback

- **路徑：** `packages/domain/src/shared/pick-problem-statement.ts:17-18`
- **動作：** 在 Prisma 查詢層保證有預設 statement，避免呼叫端多層 fallback
- **風險：** 低

#### P2-3 刪除 `hooks.server.ts` 重複的 session 驗證

- **路徑：** `apps/web/src/hooks.server.ts:148`
- **現況：** better-auth 已驗證過的 session 再被 `sessionUserSchema.safeParse` 一次
- **動作：** 刪除；信任 middleware 的型別保證
- **風險：** 低

#### P2-4 Redis cache deserializer 加 Zod

- **路徑：** `packages/redis/src/cache.ts:7`
- **現況：** 通用 `JSON.parse(raw) as T`，對 scoreboard / verdict 等關鍵快取無 schema 驗證
- **動作：** 改為 `cacheGet<T>(key, schema: ZodSchema<T>)`，強制呼叫方傳 schema
- **風險：** 低——會逼呼叫方更新簽名，但型別會抓到全部

#### P2-5 統一 `require*` 錯誤策略

- **現況：** domain 層混用 `requireX` (throw `NotFoundError`) 和 `if (!x) return null`
- **動作：** 內層一律 throw；邊界層（load function / server action）統一接住。先盤點再決定更名規則
- **風險：** 中——牽涉多個 module，建議當成獨立小 audit → plan

#### P2-6 抽共用 `DataTableWithFilters` 元件

- **路徑：** `admin/users/+page.svelte` (454)、`courses/[slug]/manage/+page.svelte` (454)
- **動作：** 抽出在兩處（與未來第三個 admin 頁面）共用的 filter + table 元件
- **風險：** 低

#### P2-7 `seed/problems.ts` 的 `as unknown as object` cast

- **路徑：** `packages/db/prisma/seeds/problems.ts:984`
- **動作：** 給 seed data 加個 `SampleSchema`，消掉 cast
- **風險：** 0

### 不需要動

- **`Tabs.svelte` (705 行)：** 職責清楚（兩套 filter tree），可做微小抽元件但不需結構重構
- **`TestcaseTab.svelte` (439 行)：** 單一職責（zip import + 編輯），保留
- **型別系統逃生艙：** `as unknown as` 只有 2 處且都有說明
- **核心 docs：** 除 P0-4 外健康
- **`docs/CP-problem/` (4.1MB)：** 使用者確認為未來題目設計素材，保留

## 4. 執行順序（建議排入 PR pipeline）

| PR  | 條目                            | 風險 | 估時           |
| --- | ------------------------------- | ---- | -------------- |
| 1   | P0-1, P0-2, P0-3, P0-4          | 0    | 0.5d           |
| 2   | P0-5（silent failure 修正）     | 低   | 0.5d           |
| 3   | P1-1（抽 `ProblemLeftPanel`）   | 中   | 1-2d           |
| 4   | P1-2（拆 `Editor.svelte`）      | 中   | 2d             |
| 5   | P1-3（拆 problem mutations）    | 中   | 1d             |
| 6   | P1-4（拆 scoreboard）           | 低   | 1d             |
| 7   | P1-5（拆 docker-executor）      | 中   | 1-2d           |
| 8   | P1-6（搬 scoring 到 domain）    | 低   | 0.5d           |
| 9   | P2 集合（P2-1, 2, 3, 4, 7）     | 低   | 1d             |
| 10  | P2-5（`require*` 錯誤策略統一） | 中   | 需先獨立 audit |
| 11  | P2-6（`DataTableWithFilters`）  | 低   | 1d             |

PR 3-8 之間幾乎無相依，可並行；PR 3 與 PR 4 有重疊（都動 Workspace / Editor），應依序做。

## 5. 成功判準

整份 cleanup 完成後，應能驗證：

- [ ] `packages/core/src/user-stats.ts` 不存在
- [ ] `.gitignore` 包含 `.tmp/` 與 `.shared/`，且工作目錄內兩者不存在（`.shared` 已刪）
- [ ] `.prettierignore` 無失效路徑
- [ ] `packages/domain/src/submission/queries.ts` 無 `safeParse` → fallback 的 pattern；改為 `parse` 直接 throw
- [ ] `apps/web/src/lib/components/problem/` 下無 500+ 行的 `.svelte` 檔案
- [ ] `apps/worker/src/services/docker-executor.ts` 被拆成至少 3 檔，每檔 < 300 行
- [ ] `packages/domain/src/problem/mutations.ts` 拆為 4 檔，每檔 < 250 行
- [ ] `packages/domain/src/contest/scoreboard.ts` 拆為 3-4 檔
- [ ] `packages/redis/src/cache.ts` 的 `cacheGet` 強制 schema 參數
- [ ] `pnpm ci:verify` 全綠
- [ ] 前端 e2e（submission lifecycle、contest scoreboard、problem workspace）全綠

## 6. 風險與注意事項

- **P0-5 不需 data migration**：使用者確認上線前會重 seed，無歷史資料包袱
- **P1 拆檔順序**：P1-1 → P1-2 是強相依；其他 P1 可並行
- **共用元件抽取的 API 穩定性**：`ProblemLeftPanel` 的 prop 介面一旦定型就會被 3+ 頁使用，design review 應謹慎
- **`require*` 策略統一（P2-5）**：這一項是整份 spec 中唯一需要先做獨立 audit 的項目——在決定 throw vs return null 之前，要盤點所有呼叫端

## 7. 本次 audit 使用的驗證方式

- 實際讀檔驗證（標註 ✅ 的項目）：`user-stats.ts`、`submission/queries.ts`、`.gitignore`、`.prettierignore`、`Workspace.svelte`、`AdvancedModeWorkspace.svelte`
- 全 repo grep 交叉驗證：`as any`（0）、`@ts-(ignore|expect-error|nocheck)`（0）、`as unknown as`（2）
- 並行 explore agents：架構、型別、死碼、防禦性程式碼、docs 五個面向各一
- Agent 間的矛盾已人工覆核（例如「`.tmp` 是否在 gitignore」）

## 8. Execution Summary (2026-04-12)

### Original audit items (P0 / P1 / P2) status

| Item | Status     | Commit(s)                                                         |
| ---- | ---------- | ----------------------------------------------------------------- |
| P0-1 | ✅ shipped | cdaa355                                                           |
| P0-2 | ✅ shipped | 9753a2a                                                           |
| P0-3 | ✅ shipped | 60524ac                                                           |
| P0-4 | ✅ shipped | b0a6146                                                           |
| P0-5 | ✅ shipped | e92d4c7                                                           |
| P0-6 | ✅ shipped | 96139c6 (CLAUDE.md doc index — landed with audit baseline commit) |
| P1-1 | ✅ shipped | 0f12460 + 7700a52 (extract + fix round)                           |
| P1-2 | ✅ shipped | e60cc88                                                           |
| P1-3 | ✅ shipped | 7f60789                                                           |
| P1-4 | ✅ shipped | 79e6bb3                                                           |
| P1-5 | ✅ shipped | d40df72 + ad96313 + 799a935 (split + reshape + break cycle)       |
| P1-6 | ✅ shipped | 5fd0c9f                                                           |
| P2-1 | ✅ shipped | fd6555d                                                           |
| P2-2 | ✅ shipped | 3740657 + 58d5c4f (flatten + strict tsc fix)                      |
| P2-3 | ✅ shipped | 2904094                                                           |
| P2-4 | ✅ shipped | 0e8530d                                                           |
| P2-5 | ✅ shipped | 05baf3d + 4cb7c6b + 8e204d7 + (FU-16 SHA tbd)                     |
| P2-6 | ❌ wontfix | n/a — audit over-estimated the overlap (see below)                |
| P2-7 | ✅ shipped | b9c5a6b                                                           |

### Follow-up items (FU-5 onward) status

| Item                                        | Status                                   | Commit  |
| ------------------------------------------- | ---------------------------------------- | ------- |
| FU-5 drop function type                     | ✅ shipped                               | 295e8ed |
| FU-6 drop editableRegions                   | ✅ shipped                               | 03bb3a2 |
| FU-7 wire customTestcases                   | ✅ shipped                               | fedd100 |
| FU-8 removal verification                   | ✅ audit (research-only)                 | n/a     |
| FU-9 Run output UI verification             | ✅ verified OK                           | n/a     |
| FU-10 require\* audit                       | ✅ audit (research-only)                 | n/a     |
| FU-11 residue cleanup                       | ✅ shipped                               | 82cf181 |
| FU-12 rename customTestcases → runCases     | ✅ shipped                               | 5065423 |
| FU-13 handleError hook + handleLoad wrapper | ✅ shipped                               | 05baf3d |
| FU-14 consolidate require helpers           | ✅ shipped                               | 4cb7c6b |
| FU-15 nullable queries → throwing           | ✅ shipped                               | 8e204d7 |
| FU-16 doc + lint guard                      | ⏳ in progress at time of this plan move | tbd     |

### Wontfix explanation (P2-6)

The audit matched `admin/users/+page.svelte` (454 lines) and `courses/[slug]/manage/+page.svelte` (454 lines) primarily by line count and the presence of a `<table>` element, but the actual content turned out to be meaningfully different. The courses manage page is only ~65 lines of embedded drilldown table surrounded by dashboard chrome (stat cards, ECharts visualizations), while the users page is built around a filter + pagination shell with inline form actions. Forcing those two surfaces through a shared `DataTableWithFilters` component would have produced a bad abstraction that served neither call site well. The right follow-up was a local-component split of `admin/users/+page.svelte` only, which was done in FU-4 (`fd2b7bb`).

### P2-5 decomposition notes

P2-5 was originally flagged as "needs independent audit first" in the original spec because throw-vs-return-null policy touches every domain query call site. FU-10 produced that audit and recommended Option A — all-throw with an explicit carve-out for truly optional lookups. The implementation was then decomposed into four reviewable PRs: FU-13 (error-boundary plumbing via `handleError` hook + `handleLoad` wrapper), FU-14 (consolidation of the scattered `require*` helpers), FU-15 (behavior change: flipping nullable queries to throwing), and FU-16 (convention guard via docs + lint rule). Each PR was independently reviewable and could be reverted without unwinding the others.

### Scope that did NOT ship

- Real E2E validation of the Run → custom test cases → sandbox flow (FU-9 was static verification only)
- Full `pnpm ci:verify` run after FU-16 merges (scheduled post-merge)
- `docs/plans/2026-04-11-design-system-refactor-design.md` pre-existing deletion still pending a decision from the user
- LeetCode-style native `function` problem type with `assembleSource` template system — deliberately out of scope; user chose to delete `function` type instead and let teachers use `multi_file` + readonly driver for that pattern
