# DOMjudge 對齊後續修復計劃

- 日期:2026-06-13
- 起點:PR #148(`2e73cd82`)對齊判題語意核心後,使用者提出 5 個後續問題 + 「還有什麼值得參考」。
- 相關活文件:[Judge Pipeline](../../architecture/JUDGE_PIPELINE.md)、[Database](../../architecture/DATABASE.md)、[Contests spec](../../specs/contests.md)、前置稽核決策 [2026-06-12-full-audit-remediation](../completed/2026-06-12-full-audit-remediation.md)
- 前置背景:本計劃所有「現況」皆經 read-only 調查逐一複驗(file:line 見各節)。

## 摘要(經調查修正後)

| #   | 項目                                | 調查結論                                                                                       | 性質                   | Effort |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- | ------ |
| 1   | caseSensitive 開關                  | **已完整實作、無 bug**;只是預設嚴格,與 DOMjudge 預設(不分大小寫)相反                           | 產品決策(非缺陷)       | S      |
| 2   | compile_error/system_error 計入罰時 | **確認是 bug**,單一函式可修                                                                    | 修復                   | S      |
| 3   | ICPC 計分可設定性                   | 競賽**已有部分設定**;但罰時分鐘/破同分/每題分數仍寫死                                          | 部分缺 + 1 個 edit gap | S–M    |
| 4   | 記憶體改讀 cgroup memory.peak       | **不是單純 bug**;2026-06-12 已**刻意否決**過,且容器跨測資重用使 memory.peak 無法給 per-case 值 | 設計抉擇(需裁示)       | M–L    |
| 5   | per-language time_factor            | 乾淨設計,單點注入即可                                                                          | 新功能                 | S      |
| +   | 其他值得參考                        | OLE verdict、bundle 無損化值得做;teams/balloons/CLICS 等 ICPC 專屬不做                         | 視範圍                 | S–M    |

---

## 1. caseSensitive — 無 bug,只需決定預設方向

**現況(已複驗):** 開關在 `packages/core/src/schemas/judge-config.ts:17`,從 schema → JudgeTab UI → `saveProblemJudgeConfig` 存檔 → `compareStandard` 判題,**端到端完整、會正確 round-trip**,沒有先前擔心的「存檔不 pass-through」問題。預設 `caseSensitive: true`(嚴格),DOMjudge default validator 無 flag 時為**不分大小寫**。

**決策(待裁示):** 是否把預設翻成 `false`(對齊 DOMjudge)?

- 翻 `false`:對未設定旋鈕的既有題目是**行為變更**(原本 WA 會變 AC)→ 需評估是否影響既有題目的判題結果。
- 維持 `true`:程式無誤,只在文件/UI 標示「NOJV 預設嚴格,DOMjudge 預設寬鬆」。

**改動點(若翻預設):** `judge-config.ts:17` 一行 + 處理「judgeConfig 無 compare 區塊」的 legacy 預設路徑 + 更新對應測試。Effort S。

---

## 2. compile_error / system_error 不該計罰時 — 確認修復

**現況(已複驗 bug):** `computeProblemCountPenalty`(`packages/application/src/scoring/problem-count.ts:29-58`)的 skip set(`:35`)只排除 `queued/compiling/running`;其餘所有非 `accepted` 狀態都進 `wrongAttempts++`(`:50`),各 +1200s(`PROBLEM_COUNT_PENALTY_PER_WRONG_SEC = 20*60`,`:15`)。因此 `compile_error`、`system_error`、`pending_upload` 三者**目前都被當成一次錯誤提交計罰時**。

此函式是**計分板顯示**(`scoreboard-builder.ts:23`)與**持久化分數**(`persist-core.ts:62` ← `run-score-update.ts:54`)的唯一交會點,改一處兩邊都修好。

**修復:** 在 `:35` 的 skip set 加入 `pending_upload`、`compile_error`、`system_error`(建議抽成 module-level `NON_PENALIZED` Set,或維持 inline 風格)。

- 計罰 = `wrong_answer / time_limit_exceeded / memory_limit_exceeded / runtime_error`
- 不計 = `compile_error / system_error / pending_upload / queued / compiling / running`;`accepted` 提早 return。

**測試:** 只需改 `tests/unit/domain/scoring/problem-count.test.ts`:

1. 既有 `:44`「treats TLE/MLE/RE/compile_error as wrong attempts」案改成只有 TLE/MLE/RE 共 3 個 wrong。
2. 新增 regression:`wrong_answer + compile_error + system_error + pending_upload + accepted` → 只計 1 次罰時。
   `persist-core.test.ts` 與 `contests.test.ts` 不受影響。選擇性更新 `docs/specs/contests.md:156` 列舉排除狀態。Effort S。

> 待裁示:`pending_upload` 是否一併排除?(建議是 — 它是「尚未真正判題」狀態,計罰不合理。)

---

## 3. ICPC 計分可設定性 — 部分已有,補關鍵旋鈕

**現況(已複驗):** 競賽**已可設定**:`scoringMode`(problem_count / point_sum)、`scoreboardMode`、`frozenAt`(凍結時刻)、`submitCooldownSec`、`allowedLanguages`(存在 `Contest` model,create + settings 表單可改)。但以下**寫死**:

- **罰時分鐘**:`PROBLEM_COUNT_PENALTY_PER_WRONG_SEC = 20*60` 常數(`problem-count.ts:15`),無 per-contest 欄位、無 env、無 UI。
- **破同分層級**:只有 2 層(`rank-util.ts:101` 分數 desc → 罰時 asc);缺 DOMjudge 第 1 層 category sortorder 與第 4 層「最後一次 AC 最早者」。同分(score+penalty 皆等)就同名次保插入序。
- **每題分數**:`ContestProblem.points` 永遠寫死 100(`mutations.ts:84`),無 UI 編輯(problem_count 模式下無關緊要;point_sum 才會用到)。
- **(順帶發現的 edit gap)** `frozenAt` 只能在 create 表單設,settings 表單的 `contestSettingsFormSchema`(`contest.ts:51`)漏掉它 → 建立後無法改凍結時刻,但 update mutation 其實支援。**這算小 bug。**

**建議分級:**

1. **罰時分鐘 per-contest(S)** — `Contest` 加 `penaltyMinutesPerWrong Int @default(20)`,串 schema(`contest.ts` create+settings)、mutations、把值傳入 `computeProblemCountPenalty`/`buildProblemCountScoreboard`/`computeProblemCountState`(取代常數),UI 加數字輸入。需 migration。
2. **修 freeze-time edit gap(XS)** — `contestSettingsFormSchema` 加回 `frozenAt` + settings UI;mutation 已支援。
3. **破同分層級(M,選做)** — 若要真 DOMjudge parity 才加「最後 AC 最早」tiebreaker(+ 可選 category sortorder,需新分組欄位,較大)。
4. **每題分數編輯(M,選做)** — 僅 point_sum 競賽需要。

**決策(待裁示):** 範圍只做 1+2(直接回應「競賽該有設定」),還是含 3/4 的完整 parity?

---

## 4. 記憶體 memory.peak — 設計抉擇,非單純 bug(需裁示)

**重要修正:** 這**不是**可以「一行修掉」的 bug,且 **2026-06-12 稽核已刻意否決過 cgroup memory.peak**(`docs/plans/completed/2026-06-12-full-audit-remediation.md:31`)。否決理由仍然成立:

1. **共用 cgroup 會超報**:judge 與 runner(Node,baseline V8 heap ~40–55MB + stdout/stderr 各 16MB buffer)**共用同一容器 cgroup**(runner 是 PID 1,judge 是其 child,無巢狀 cgroup)。直接 `cat /sys/fs/cgroup/memory.peak` 會把 runner 自身佔用混進去 → 對 16–64MB 小限額題目**系統性誤判 MLE**。
2. **巢狀 per-process cgroup 被擋**:non-root + `--cap-drop ALL` + read-only rootfs 無法 mkdir 子 cgroup。
3. **跨測資重用容器**:標準判題在**同一個 runner process 內迴圈所有測資**(`apps/sandbox-runner/src/index.ts:316-329`)。`memory.peak` 是容器生命週期的**單調高水位**,無法回推 per-case 峰值(除非每測資一個容器,或重置 memory.peak — 後者被 cap-drop 擋)。

**而且:記憶體上限其實已由 cgroup 強制。** `--memory N --memory-swap N`(swap 關)→ 超限觸發 OOM-killer → SIGKILL → `run-process.ts:157` 判 MLE。所以「**限制的強制**」已是 cgroup 等級;`/proc VmRSS` 取樣只影響**回報的數字**與「峰值剛好略超但沒被 OOM」的二次判定(`check-standard.ts:11`)。

**三條路線(待裁示):**

- **(A) 比例修正(S,建議起步)** — 承認 2026-06-12 否決仍成立,只把取樣間隔 `MEMORY_POLL_INTERVAL_MS`(目前 `25`,當初計劃打算 10)調低以縮小漏報視窗。MLE 強制已靠 OOM,改善的是回報數字保真度。低風險。
- **(B) 架構重做(L)** — 改成**每測資一個 sandbox 容器**,容器結束讀一次 `memory.peak` 並減去 runner baseline(`memory.current` 開跑前取樣,或經驗常數),`peak >= limit` 判 MLE,memory.peak 不存在(kernel <5.19 / cgroup v1)時 fallback 回 poller。能得到精準 per-case 峰值,但動到 executor 容器生命週期,成本高、且與測資平行化計劃相關。
- **(C) 不動** — 接受 OOM-SIGKILL 已正確強制上限,VmRSS 數字僅供顯示參考。

> 我的建議:先 (A);(B) 併入「單題測資平行化」計劃一起評估(兩者都改容器生命週期)。除非你要的是精準 per-case 記憶體**數字**而非正確的 MLE **判定**,否則 (B) 的成本不划算。

---

## 5. per-language time_factor — 設計

**現況:** 無任何 time_factor;所有語言共用同一 `Problem.timeLimitMs`(`problem.ts:79`,可被 `judgeConfig.runtime.timeLimitMs` override)。唯一把限額變成沙箱預算的注入點是 `apps/worker/src/activities/judge.ts:215`(`timeoutMs: judgeContext.runtime.timeLimitMs`),而**語言就在同一處 in scope**(`draft.language`,`:201`)。下游所有時間天花板(CPU soft TLE、CPU rlimit、wall grace ×2、docker outer timeout、k8s deadline、validator timeout、interactive grace)**全由 `timeoutMs` 推導** → 只要在這一點乘上係數,全部自動跟著放大,其餘檔案不動。

**設計(DOMjudge 模式 = base × factor,預設 1.0,僅時間、不做記憶體係數):**

於 `packages/core`(新檔 `judge/time-factor.ts` 或併入 `sandbox.ts`,比照既有 `Record<Language,T>` 慣例如 `sourceFileNames`):

```ts
export const LANGUAGE_TIME_FACTOR: Record<Language, number> = {
  c: 1,
  cpp: 1,
  rust: 1,
  go: 1.5,
  javascript: 2,
  typescript: 2,
  java: 2,
  python: 3,
};
export function effectiveTimeLimitMs(baseMs: number, language: Language): number {
  return Math.ceil(baseMs * LANGUAGE_TIME_FACTOR[language]);
}
```

在 `judge.ts:215` 改為 `effectiveTimeLimitMs(judgeContext.runtime.timeLimitMs, draft.language)`。**不要**在 `getJudgeContext`(`queries.ts:403`)乘 — 那裡沒有語言、且供顯示用,會污染 base。

**改動點:** ① core 加 map+函式並匯出 ② `judge.ts:215` 包一層 ③(選做)`buildAdvancedPayload` 的 `totalTimeMs` ④ 測試(core 窮舉每個 Language key + worker 測 java/python 拿到放大值) ⑤ `JUDGE_PIPELINE.md` 記錄「有效軟限 = timeLimitMs × LANGUAGE_TIME_FACTOR」。Effort S。

**決策(待裁示):** ① 係數值(go=1.5 / js,ts,java=2 / python=3 是否 OK)② 是否套用 Advanced Mode(建議 v1 不套)③ 全域 const map(建議)還是現在就要 per-problem override(需 migration + judgeConfig pass-through,建議延後)。

---

## + 其他值得從 DOMjudge 參考的(已對齊產品方向)

**ADOPT(契合課程/考試平台):**

- **OLE(output-limit-exceeded)verdict(S)** — 教學價值最高:目前輸出爆量在 16MB 被靜默截斷後比成 WA,學生看到莫名 WA。`BoundedBuffer` 已有 `truncated` flag,把它透出到 `classifySolutionVerdict` → 新增 `OLE` SandboxVerdict(或併入 RE 避免擴 enum)。**不**加 no-output(空輸出本就該 WA)。順帶把輸出上限做成 `runtimeSchema` 可設定,與 16MB OOM-guard 脫鉤。
- **bundle 無損化(M)** — 這才是「lossy bespoke ZIP」的務實解。**不**追 Kattis/ICPC problem package 格式(對單一機構課程平台是錯的受眾、高成本)。改成讓既有 `importBundle/exportBundle`(`bundle.ts`)保留 TestcaseSet 邊界、per-set weight、isSample、per-problem 時間/記憶體限制(加個 `sets.json` manifest),消除「全部塌成一個 `Imported` set」的真實損失。

**MAYBE(出現實測觸發才做):**

- **scorecache 渲染路徑(M)** — 物化值已在 `Participation.score/subtaskScores`,但 `getScoreboard` 每次仍全量重算。課程/考試規模(數十~數百人)目前沒問題;有實測延遲再接。比照測資平行化計劃「先量測、預設不開」。
- **lazy_eval(S,低價值)** — 只對單 set ICPC 題有意義(IOI/partial 必須全跑)。課程情境學生想看「哪些案失敗」,run-all 才是好教學預設。只有 rejudge 風暴成本被實測為痛點才加 opt-in flag。

**SKIP(ICPC 專屬或設計上不適用):**

- presentation-error:token 比對忽略空白,結構上不可能發生(DOMjudge default validator 自己也拿掉了)。
- configurable results_prio:混合失敗的 niche operator 旋鈕,教學用「第一個失敗案」已足。
- multi-pass / nextpass:罕用題型。
- judgehost health/quarantine:N/A — 無常駐 judgehost,stateless Temporal worker + retry + stale reaper 是正確的架構等價物。
- per-language entry-point / multi-file:**已實作**(`entryFileNameFor` 等)。
- ICPC 賽控專屬:teams / categories / affiliations / balloons / awards / CLICS Contest API / event-feed / shadow judging / resolver / 公開報名 — 與單機構課程/考試平台定位不符,**明確不做**。

---

## 建議實作順序與里程碑

1. **Wave 1（純修復,低風險,可立刻做）**:#2 罰時排除狀態 + #3.2 freeze-time edit gap。皆 S、各自 TDD。
2. **Wave 2（小新功能,待 #5/#1 裁示)**:#5 time_factor(係數確認後)、#1 caseSensitive 預設(若決定翻)。
3. **Wave 3（需設計裁示)**:#3.1 罰時分鐘 per-contest(+ migration);#3.3/3.4 視範圍。
4. **Wave 4(視價值)**:OLE verdict、bundle 無損化。
5. **memory.peak(#4)**:預設走 (A) 比例修正;(B) 併入測資平行化計劃另議。

## 裁示結果與實作狀態(2026-06-13)

- [x] **#1 caseSensitive**:**維持嚴格(true)**,不動程式。✅ 已在 `JUDGE_PIPELINE.md` 標示與 DOMjudge 預設方向相反。
- [x] **#2 罰時**:✅ **已實作**。`computeProblemCountPenalty` 改用 `NON_PENALIZED_STATUSES` Set,排除 `pending_upload / compile_error / system_error`。TDD,3 個新/改測試綠。
- [x] **#3 ICPC**:✅ **已實作**(罰時分鐘 per-contest + freeze edit gap)。Prisma `penaltyMinutesPerWrong @default(20)` + migration `20260613030000` + DATABASE.generated.md 同步;core schema(create/settings/update/form)、mutations、scoring 全鏈(`TimedSession.penaltyPerWrongSec`、`computeProblemCountState`、`ScoringUpdate` adapter、`getScoreboard`)、ContestDetail、settings/create UI + i18n(en+zh-TW)。freeze gap:`frozenAt` 加回 settings 表單 + UI。
- [x] **#5 time_factor**:✅ **已實作**。`packages/core/src/judge/time-factor.ts`(`LANGUAGE_TIME_FACTOR` + `effectiveTimeLimitMs`),在 `judge.ts:215` 單點注入。係數 `c/cpp/rust=1、go=1.5、js/ts/java=2、python=3`,不套 Advanced Mode。TDD core 測試綠(worker 整合測試因 Temporal heartbeat 在單元情境的 Activity context 限制移除,行為由 core 測試覆蓋)。
- [x] **#4 記憶體 (B)**:✅ **Docker + K8s 標準模式皆已實作 + 實機判題驗證通過**(K8s 用 OrbStack 內建叢集實測)。採每測資一容器 + 讀 `memory.peak`(減 `memory.current` baseline,與 VmRSS poller 取 max,memory.peak 缺漏時 fallback poller)。
  - **runner 協定統一**:phase(compile / run-case)+ caseIndex 由 env(`SANDBOX_PHASE`/`SANDBOX_CASE_INDEX`,K8s 用)或 `config.mode`(Docker 用)解析;compile 相把產物 + `run-command.json` 寫進 `/artifact`,run-case 相從 `/artifact/run-command.json` 或 config 取得 runCommand。
  - **Docker**:compile 容器(`/artifact` rw bind)→ N 個 run 容器(`/artifact` ro)。實測 Python 30MB→`≈39MB`、C++ touch 40MB→`≈41MB`、C++ `-O2` 最佳化掉→`≈1MB`(證明量真實 RSS)、`runStandardMode` 3 測資端到端 AC/AC/WA 正確。
  - **K8s**:單一 Pod = init compile 容器(寫 `/artifact` emptyDir)+ N 個 run 容器(各自 cgroup→各自 memory.peak;`/tmp`、`/workspace` 用 subPath 隔離)。實測 3 測資端到端 AC/AC/WA + 準確 per-case memoryKb(~34–42MB,與 Docker 一致);C++ 語法錯誤→正確回 `compilationError`(init 容器 log 解析)。
  - ⚠️ **仍未做**:checker/interactive 未端到端煙測(checker 走同一 per-case 路徑,理論上 OK)。
- [ ] **OLE verdict / bundle 無損化**:列為 ADOPT 建議,**本批不做**,待後續確認。

## #4(B) 實機探測結果(2026-06-13,OrbStack kernel 7.0.11 / nojv-sandbox:local)

以沙箱完整安全旗標(`--user 10001 --cap-drop ALL --read-only --memory 64m`)實測:

- ✅ `/sys/fs/cgroup/memory.peak` **可被 non-root 沙箱使用者讀取**,且是容器自身 cgroup(`memory.max` == `--memory` 限額,確認非 host cgroup)。
- ❌ `memory.peak` **無法重置**(寫入回 `Read-only file system`,因 `--read-only` + cgroupns)。→ 同一容器內**逐測資重置高水位不可行**。
- ❌ 巢狀 per-process cgroup 仍被擋(`/sys/fs/cgroup` 唯讀,無法 mkdir)。
- 🔑 **重要更正**:docker `--memory` 用的是**固定平台值 `SANDBOX_MEMORY_MB`(預設 256)而非每題 memoryLimitMb**;**每題記憶體上限的 MLE 是由量測數字在軟體層判定**(`check-standard.ts enforceMemoryLimit`:`memoryKb > problemLimit*1024` → MLE),cgroup OOM 只在平台值兜底。→ **量測準確度是「正確性」問題,不只是顯示**(先前評估說「OOM 已正確強制上限」不精確:OOM 強制的是平台值,題目上限靠量測)。

**結論**:因 memory.peak 不可重置、容器=單一 cgroup,**要拿到準確的 per-case 峰值,唯一路徑是「每測資一個容器」**。而每測資一容器又必須**編譯一次、產物跨容器共用**(否則每測資重編譯,C++/Rust/Java 成本不可接受)+ N 次 docker run。**這實質上就是「單題測資平行化」的容器架構**(`docs/plans/active/2026-06-13-testcase-parallelization.md`)。兩者應一起做,否則平行化會重做一遍同樣的 executor 重構。

## #4(B) 獨立 PR 的實作設計(待動工)

1. `apps/sandbox-runner/src/utils.ts`:新增純函式 `parseCgroupMemoryBytes` + `readCgroupMemoryPeakBytes`(`/sys/fs/cgroup/memory.peak`)+ `readCgroupMemoryCurrentBytes`(`memory.current`),比照既有 `parseCgroupCpuUsageUsec` 的「純解析 + fixture 測試」模式。
2. **executor 改每測資一容器**(`standard-mode-executor.ts` / `index.ts:316-329` 的迴圈):讓每個 testcase 在獨立容器執行,使 `memory.peak` 為 per-case;否則容器重用下 memory.peak 是單調高水位、無法回推 per-case。
3. 每容器結束讀 `memory.peak` 減去開跑前 `memory.current` baseline(去除 Node runner ~40–55MB 佔用),`peak >= memoryLimitMb` 判 MLE,並保留 OOM→SIGKILL 為主信號。
4. fallback:`memory.peak` 不存在(kernel <5.19 / cgroup v1)→ 維持現有 VmRSS poller + `enforceMemoryLimit`。
5. 影響評估:容器啟動 × N 測資的延遲、`outerTimeoutMs` 計算、k8s job 模型;需與測資平行化計劃對齊。
6. **驗證:必須實機跑判題**(build sandbox image + 提交 Java/Python/小限額題),確認 16–64MB 小限額題不再誤判 MLE、JVM 量測準確。

## #4(B) 剩餘工作(Docker 已完成後)

- **K8s executor 對齊(必做才能上 prod)**:`apps/worker/src/services/k8s-executor.ts` 仍是舊單容器模型。prod 走 K8s,需把同樣的 compile-job + per-case-job + memory.peak 模型搬過去,並在 staging K8s 叢集實機驗證(本機無法驗 K8s)。在此之前,dev(Docker)有準確 per-case memory.peak,prod(K8s)維持舊 VmRSS 取樣 — 兩者量測行為分歧但都能運作。
- **checker / interactive 煙測**:checker 走同一 `runContainer`(per-case rawRuns)→ `resolveCheckerResult`,理論上不受影響但未端到端測;interactive 走獨立 `runInteractiveMode`(未改、未上 memory.peak)。
- **效能**:per-case 容器 = N 次容器啟動(~1s/個);compile 仍只一次(無重編譯)。大測資題的 wall-clock 增加,待測資平行化(並行跑這些 per-case 容器)抵銷。
- **baseline 量測誤差**:`memory.peak − memory.current(spawn前)`;若 node runner 啟動尖峰 > 常駐,小程式可能略為高估。實測 Python/C++ 皆準確,但極小限額題(16–32MB)上線前值得再壓測。

## 待後續確認(本批不實作)

- OLE 用獨立 verdict 還是併入 RE;bundle 無損化是否足夠(vs 真的要吃外部 DOMjudge package)。
- #4(B) 每測資一容器對效能(容器啟動 × N 測資)與 docker/k8s timeout 計算的影響,與「單題測資平行化」計劃的耦合。
