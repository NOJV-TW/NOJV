# DOMjudge 對齊:Subset 全對計分收斂 + standard/checker 比對一致

狀態:**實作完成,待 commit/PR**(2026-06-13)。Part A/B/C 全做完;1399 unit + typecheck(16/16)

- lint + format 全綠;dev + test DB 已 `db push`;migration `20260613020000_drop_subtask_scoring_strategy`
  已補;`DATABASE.generated.md` 已重生。整合測試 307 綠(2 個 rust 冷編譯逾時 flake 與本次無關,
  重跑 judge-integration 50/50 綠)。

## 背景與已拍板決策

源自「NOJV 判題流程 vs DOMjudge」評估。使用者已逐項拍板:

1. **Subset 計分一律 all-or-nothing**:一個 subtask(TestcaseSet)內**所有**子測資全對,該
   subtask 才拿到它的 weight,否則 0。**不論練習/作業/競賽/考試,任何情況都如此。**
   競賽賽制只在「整題分數」層級再聚合,不影響 subtask 的全對判定(此部分現況已正確,不動)。
2. **checker / interactor 只做 AC/WA 特殊判定**(多重解等),不回傳部分分。移除 `score.txt`
   部分分通路。
3. **D1 `standard` 比對對齊 DOMjudge default validator**,預設語意:
   - 大小寫:**保持敏感(嚴格)** ← 與 DOMjudge default 不同,使用者明確要求
   - 空白:**token 比對、空白量不敏感** ← 同 DOMjudge default
   - 浮點:**預設無容差**,可由 flag 開啟 ← 同 DOMjudge default
4. **D2 per-problem validator flags 透傳**:對應 DOMjudge `validator_flags` / `compare_args`。

### 已最終確認(2026-06-13)

僅作用於 `standard` 判題型別,per-problem 設定:

- **空白 / 換行**:**寫死自動合併,不開 UI**。token 化(任意空白序列含換行皆等價;
  `"1\n2"`=`"1 2"`=`"1  2"`)。⚠️ 會改現有 standard 題目判定(現在 `"1  2"` vs `"1 2"` 會 WA,改後 AC)。
- **大小寫**:**提供 UI 欄位**。預設 `caseSensitive=true`(嚴格),出題人可關成不分大小寫。
- **浮點容差**:**提供 UI 欄位**(單一 ε)。預設**無=精確比對**(= DOMjudge 預設行為:無容差、
  無預設 ε),出題人可填 ε,套用為 absolute OR relative(同 DOMjudge `float_tolerance` 簡寫)。
- **checker / interactor**:維持 AC/WA-only、自包含,**不做 validator flag 透傳**。這些 UI 欄位
  只給 `standard`;要更複雜的比對就寫 checker。

---

## Part A — Subset 計分收斂為 all-or-nothing

### A1. Schema / DB

- `packages/db/prisma/schema/problem.prisma`:移除 `enum SubtaskScoringStrategy` 與
  `TestcaseSet.scoringStrategy` 欄位。
- 出 migration `drop_subtask_scoring_strategy`(drop column + drop enum type)。dev DB 走
  `pnpm db:push`;production 走 migration。更新 `DATABASE.generated`(漂移 gate)。

### A2. Scoring 邏輯

- `packages/application/src/submission/scoring.ts`:
  - `buildSubtaskResults` 移除 `strategies` 參數與 `caseScores` 收集;`computeSubtaskRawScore`
    刪除,改為 inline `rawScore = allPassed ? weight : 0`。
  - `mapResult` 不再傳 `judgeContext.subtaskStrategies`。
- `packages/application/src/submission/queries.ts:410-412`:移除 strategy map 建構。
- `packages/application/src/submission/types.ts`:移除 `SubtaskStrategyMap` 型別與
  context 上的 `subtaskStrategies` 欄位。

### A3. checker / interactor → AC/WA only(移除部分分)

- `packages/core/src/judge/validator.ts`:移除 `parseScore`、`ValidatorOutcome.score`、
  `ValidatorFeedbackFiles.scoreTxt`,`parseValidatorFeedback` 不再讀 score。
- `apps/sandbox-runner/src/judges/validate.ts:87`:不再讀 `score.txt`。
- `apps/sandbox-runner/src/judges/interactive-isolated.ts:180`:不再讀 `score.txt`。
- `apps/worker/src/services/check-standard.ts`:`mergeCheckerResults` 的 per-case score 改純
  verdict 衍生(AC=100/否則 0);追蹤 `SandboxTestcaseResult.score` 是否還有用(若僅供顯示則
  保留 verdict 衍生值,若全無使用則一併移除)。
- wrappers:`python-validator.py` / `python-interactor-domjudge.py` 移除 `set_score()`。
- scaffold / 文件中關於 `score.txt` 的說明一併移除。

### A4. 前端 UI

- `apps/web/src/lib/components/features/problem/testcase/TestcaseSetCard.svelte:153-163`:移除
  策略 `<select>` 與 `SCORING_STRATEGIES`、hint。
- `apps/web/src/lib/components/features/problem/tabs/TestcaseTab.svelte:32-37,71`:移除
  `strategyLabel` 與顯示。
- 移除 i18n key:`testcases_scoringStrategy*`(找出 paraglide message 來源檔,en + zh-TW)。

### A5. 測試 / seed

- 刪除/改寫:`tests/unit/domain/subtask-partial-score.test.ts`(整支關於部分分,刪除)、
  `tests/unit/domain/build-subtask-results.test.ts`(移除 PROPORTIONAL/MINIMUM 案例,
  保留並強化 all-or-nothing)、`tests/unit/domain/judge-context.test.ts`(移除 strategy map)。
- `packages/db/prisma/seeds/problems.ts`:移除任何 scoringStrategy 設定。

---

## Part B — D1:standard 比對器(token 化 + 可選大小寫/浮點)

核心改 `packages/core/src/judge/compare.ts`:

```ts
export interface CompareOptions {
  caseSensitive?: boolean; // default true
  floatTolerance?: number | null; // ε;null/undefined = 精確
}
export function compareStandard(actual, expected, opts?: CompareOptions): boolean;
```

演算法:

1. 兩邊各自 **whitespace tokenize**(`split(/\s+/)` 去空字串;任意空白序列含換行皆為分隔,
   首尾空白忽略)。**永遠**如此,不可關。
2. token 數須相同,否則 WA。
3. 逐 token 比對:
   - 若 `floatTolerance` 有值且兩 token 皆 parse 成有限數值 → `|a-b| <= ε` **或**
     `|a-b| <= ε*|b|`(absolute OR relative,同 DOMjudge `float_tolerance` 簡寫)即通過。
   - 否則字串比對:`caseSensitive`(預設 true)→ `===`;false → 兩邊 `toLowerCase()` 後比。

預設(無 opts / 無 `compare` 區塊):`caseSensitive=true`、無浮點容差 → 即「大小寫嚴格、
空白合併、精確數值」。

現有呼叫點(worker 端 `check-standard.ts` 的 `resolveStandardResults`)帶入 per-problem opts。

> 註:`apps/sandbox-runner/src/judges/standard.ts` 也有正規化常式,實作時確認比對的單一真實
> 來源,避免兩份語意漂移(優先讓兩處共用 `compare.ts`)。比對在 worker 端進行(run 容器不持有答案),
> 故 opts 只需流到 worker,不必進 sandbox 容器。

---

## Part C — D1 設定欄位 + 出題 UI(僅 standard)

`packages/core/src/schemas/judge-config.ts` 新增:

```ts
compare: z.object({
  caseSensitive: z.boolean().default(true),
  floatTolerance: z.number().positive().max(1).nullish(), // ε;null = 精確
}).nullish(),
```

- 不做 `spaceChangeSensitive`(空白永遠合併)、不做 `validatorFlags`(checker 自包含)。
- `compare` 經 `judgeContext` 流到 worker `resolveStandardResults` → `compareStandard(opts)`。
- 出題 UI(judge 設定區,**僅當 type=standard 顯示**):大小寫核取方塊 + 浮點容差數字欄(留空=精確)。
  i18n 補 key(en + zh-TW)。
- checker / interactor 設定區**不**顯示這些欄位。

---

## 驗證(TDD)

- 先寫測試再改實作。重點測試:
  - all-or-nothing:一案 WA → 整個 subtask 0;全 AC → 滿 weight。多 subtask 加權。
  - 比對器:預設大小寫差異 WA;`"1  2"`=`"1 2"`=`"1\n2"` 預設 AC(空白/換行合併);
    token 數不符 WA;`caseSensitive=false` 大小寫差異變 AC;`floatTolerance` 邊界(abs OR rel)、
    無容差時 `1.0` vs `1.00` 仍 WA(非數值精確)、設容差後通過;非數值 token 不受容差影響。
  - checker/interactor:exit 42/43 → AC/WA;不再因 score.txt 改變結果。
- `pnpm ci:verify`(typecheck/lint/unit/integration)、`pnpm db:push`(dev)、判題端到端
  (記憶教訓:mock 測不到 sandbox docker-arg,需實機跑一次判題驗證)。

## 文件

- 改寫 `docs/architecture/JUDGE_PIPELINE.md`:score 段(刪三策略、改 all-or-nothing)、check 段
  (standard 比對語意 + flags、checker/interactor AC/WA-only)、移除 score.txt 部分分敘述。
- 完成後本計劃移至 `docs/plans/completed/`。
