# Contest / Exam / Assessment 三胞胎模型收斂 — 設計評估

> **For Claude:** 這是**設計/決策 doc**,不是逐 task 實作計劃。實作前需使用者就「決策點」拍板;批准後才依「分階段計劃」用 superpowers:executing-plans 推進。

**Goal:** 決定(並在批准後分階段)收斂 Contest / Exam / Assessment(+ VirtualContest)這組「有時限、會計分的評量」的**重複**——分兩個獨立的收斂槓桿,各有不同風險。

**承接:** 風險#1 第一步(persist 計分純核心抽取)已於 PR #110(`850b271d`)落地——見 [`2026-06-11-post-audit-next-phase.md`](./2026-06-11-post-audit-next-phase.md) 風險#1 段。本 doc 評估「後段」。

---

## 現狀(#110 之後)

- ✅ **已收斂**:唯讀記分核心(`scoring/scoreboard-builder|problem-count|rank-util`)+ persist 計分純核心(`scoring/persist-core.ts` 的 `computeBestScoreState`/`computeProblemCountState`,contest/exam 共用)。歷史上 PR#83「exam 漏呼叫 updateExamScores」那類漂移的**計分內部**部分已消除。
- ⚠️ **仍重複**:
  - `updateContestScores` / `updateExamScores` 的**外層編排**(retry loop + conflict-class 捕捉)。
  - `contestParticipationRepo.updateWithVersion` / `examParticipationRepo.updateWithVersion` / `virtualContestRepo.updateWithVersion` + 三個 conflict class(`ParticipationVersionConflict` / `ExamParticipationVersionConflict` / `VirtualContestVersionConflict`)。
  - `Submission` 的 context 資料模型:`contestId` / `examId` / `assessmentId` / `virtualContestId` 四個 nullable FK + XOR CHECK(`Submission_single_context_chk`)+ 7 條複合 `@@index` + 混合 `onDelete`(`exam`/`contest`/`virtualContest` = `Cascade`,`contestParticipation`/`course`/`assessment` = `SetNull`)。

---

## 兩個獨立的收斂槓桿

### 槓桿 1 — 編排層收斂(低風險)

把 `updateContestScores` / `updateExamScores` 收成**單一實作 + 薄 context adapter**。兩者唯一的真實分歧:

| 分歧點          | contest                                        | exam                                  |
| --------------- | ---------------------------------------------- | ------------------------------------- |
| submission 抓取 | `findForParticipationScoring(participationId)` | inline `findMany({ examId, userId })` |
| 回傳值          | `contestId`(給 `publishScoreboardUpdate`)      | `void`                                |
| conflict class  | `ParticipationVersionConflict`                 | `ExamParticipationVersionConflict`    |

抽一個 `ScoringContextAdapter` 介面(`loadParticipation()`, `loadSubmissions()`, `loadOverrides()`, `persist(state) → updateWithVersion`, `onConflict`),把共用的 retry loop + persist-core 呼叫收成一份 `runScoreUpdate(adapter)`。各 context 提供自己的 adapter。**無 migration、純 domain 內、現有 race 測試守門。**

### 槓桿 2 — 資料模型收斂(高風險)

把 `Submission` 的 4 個 nullable context FK 收成多型 `(contextType, contextId)`。**衝擊面(已查實)**:

- 重寫 XOR CHECK(且先修 migration `20260416180001` 的 `courseAssessmentId` vs schema `assessmentId` 欄名漂移)。
- 7 條複合 `@@index` 全部改成 `[contextType, contextId, …]` 形態並驗新 query plan;`contestParticipation` 的兩層(participationId→userId)關係要重新設計。
- ~90 檔 FK 字串引用(repo 約 45 處 + domain/web routes);`deriveSubmissionMode`、所有 `findForXScoreboard/Chart/ParticipationScoring`、exam inline findMany 重寫。
- **失去 DB 級 FK 級聯**:`Cascade`/`SetNull` 語意降級——多型欄沒有 DB FK,刪父表不再自動清/置空,需 trigger 或應用層補。**這是真正的功能性退步**,是最高風險點。

---

## 建議

1. **做槓桿 1**(編排 adapter)——✅ **已實作(2026-06-11)**:`scoring/run-score-update.ts` 的 `runScoreUpdate(participationId, adapter)` 把 retry loop + scoringMode 分支 + persist-core 呼叫收成一份;`updateContestScores`/`updateExamScores` 各剩 ~12 行的 adapter(`load`/`submissions`/`overrides`/`persist`/`isConflict`)。刪掉 `persistContest*`/`persist*` 四個重複函式。`run-score-update.test.ts`(6 例)+ 既有 race 測試行為等價守門全綠。「改一處漏改另一處」那類 P1 漂移從此結構性不可能。
2. **不做 / 無限期遞延槓桿 2**(FK 多型化)——級聯降級 + ~90 檔 blast radius 的成本**高於效益**;nullable-FK + XOR CHECK + 複合 index 的現行模型已**安全且夠快**,多型化不會簡化 participation 端(participation 仍是三份)。**只在新增第 4+ 種 context 型別時才重新評估。**
3. VirtualContest / Assignment **別硬拉進統一**:virtual 讀時用 `buildScoreboard` 不落地、assignment 用 Prisma `_max` aggregate,是不同計分形態。

---

## 分階段計劃(若槓桿 1 批准)

> 批准後改用 superpowers:executing-plans 逐 task;TDD + 頻繁 commit。

- **Task 1** — 在 `packages/domain/src/scoring/` 定義 `ScoringContextAdapter` 介面(loadSubmissions/loadOverrides/persist/onConflict)+ 共用 `runScoreUpdate(adapter)`(搬 retry loop,內部呼叫 persist-core)。先寫 `runScoreUpdate` 單測(mock adapter:conflict→retry、3 次→拋 ConflictError、participation 不存在→no-op)。
- **Task 2** — `contest/scoring.ts`:`updateContestScores` 改成建 contest adapter → `runScoreUpdate`;保留回傳 `contestId`(adapter 的 `persist` 後回 contestId)。跑 `contest-scoring-race` 回歸。
- **Task 3** — `exam/scoring.ts`:同樣建 exam adapter → `runScoreUpdate`;回傳 `void`。跑 `exam-scoring-race` 回歸。
- **Task 4** — 評估是否把三份 `updateWithVersion` + conflict class 收成泛型 repo helper。**先做 spike 確認 Prisma 型別安全不被犧牲**(#110 spike 判定「跨三 model 型別參數化犧牲型別安全」→ 很可能維持三份,只是 adapter 包起來);型別安全無法保時**不做**。
- **驗收**:`updateContestScores`/`updateExamScores` 行為等價(race 測試 + persist-core 測試全綠)、外層 retry 邏輯單一來源、`pnpm ci:verify` 綠。

---

## 需要你拍板的決策點

1. ~~**槓桿 1(編排 adapter)** — 批准做嗎?~~ ✅ **已做(2026-06-11)**,見上。
2. **槓桿 2(Submission FK 多型化)** — 無限期遞延(建議)vs 仍要先做衝擊 spike?**仍待拍板**。
3. **Task 4(`updateWithVersion` 泛型化)** — 三份 `updateWithVersion` + conflict class 仍各自存在(由 adapter 的 `persist`/`isConflict` 包起來),**刻意未泛型化**(跨三 Prisma model 參數化會犧牲型別安全)。如要再收斂需先做型別安全 spike。
