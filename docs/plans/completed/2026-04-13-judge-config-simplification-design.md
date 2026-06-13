# Judge Config Simplification — Compare Mode Removal, Subtask Strategy Relocation, Checker/Interactor DX

**Date:** 2026-04-13
**Scope:** `apps/web/src/lib/components/problem/tabs/{JudgeTab,TestcaseTab}.svelte`, `packages/core/src/schemas/judge-config.ts`, `packages/db/prisma/schema/problem.prisma`, `packages/application/src/submission/judge-context.ts`, `apps/sandbox-runner/src/judges/{standard,checker,interactive}.ts`, `apps/sandbox-runner/src/compiler.ts`, sandbox image
**Status:** Design approved, awaiting implementation

## Background

The current problem-edit Judge tab exposes three concerns mixed together:

1. A **compare mode dropdown** with five options (`exact`, `ignore_whitespace`, `ignore_case`, `float`, `regex_filter`) plus float tolerance and regex pattern fields.
2. **Checker / Interactor scripts** in five languages (`bash`, `python`, `node`, `c`, `cpp`) with no in-product documentation of the script protocol.
3. A **subtask scoring strategy** picker, even though strategies are inherently a property of the subtask itself (defined in the Testcase tab).

Three usability problems result:

- **Compare modes are non-standard.** Mature competitive OJs (Codeforces, DMOJ, Kattis, ICPC tooling) do not expose a comparison-mode dropdown. They apply a single canonical text normalization (CRLF→LF, per-line trailing whitespace, trailing blank lines), and delegate everything else (float tolerance, custom matching) to a checker. The current dropdown gives the false impression that picking the "right" mode replaces writing a checker.
- **Checker/interactor scripts are undocumented.** A teacher opening the Monaco editor sees a blank file. The protocol (argv layout, exit codes, stdout/stderr semantics, score range) is buried in `apps/sandbox-runner/src/judges/{checker,interactive}.ts` comments. Even authors who know the protocol still have to write ~20 lines of argv parsing + file reading + exit boilerplate before the actual logic.
- **Scoring strategy is on the wrong tab.** The strategy (`all_or_nothing` / `proportional` / `minimum`) belongs to a specific subtask. Editing a subtask's strategy from the Judge tab while editing its name and weight on the Testcase tab forces context switching for a single conceptual edit.

Out of scope:

- Adjustment rules (`time_bonus`, `late_penalty_decay`) on `CourseAssessment.adjustmentRules` — they live elsewhere and are not affected.
- Advanced-mode (custom Docker image) judging — `judgeConfig` for advanced problems is a separate path.
- Any change to the testcase upload / ZIP parsing UI.

## Decisions

1. **Delete the compare mode UI and schema entirely.** Standard judge applies a single canonical normalization. Float and custom matching → write a checker.
2. **Move the subtask scoring strategy from `judgeConfig.scoring.subtaskStrategies` (a JSON bag keyed by set id) to a `scoringStrategy` column on `TestcaseSet`.** The UI moves to the Testcase tab.
3. **Restrict checker/interactor language choice to Python and C++.** Bash / Node.js / C are removed (only for checker/interactor scripts — student solution languages are unaffected).
4. **For C++, bundle Codeforces `testlib.h`** under `apps/sandbox-runner/assets/testlib/`. License confirmed MIT (verified 2026-04-13 against `MikeMirzayanov/testlib` GitHub). Sandbox image installs it to `/usr/include/testlib.h`. Ship the upstream `LICENSE` alongside and add a line to repo `THIRD_PARTY_NOTICES`.
5. **For Python, auto-prepend a wrapper** before writing the script to disk. The wrapper exposes named globals (`judge_input`, `judge_output`, `process_output`) and helper functions (`accept`, `reject`, `partial`; plus `read`/`write` for interactor) so the user only writes the comparison logic. Names borrow DMOJ's `process_output` / `judge_output` / `judge_input` convention to avoid shadowing Python's built-in `input`.
6. **Add an in-product documentation panel** above the Monaco editor in the Judge tab, collapsed by default, that describes the chosen language's API and shows a runnable example.

## Feature: Standard Judge Normalization

### Change

`apps/sandbox-runner/src/judges/standard.ts`:

- Delete `Compare` import, `compare` parameter, `collapseWhitespace`, `applyLineFilter`, `floatMatch`, `DEFAULT_FLOAT_*` constants, the `mode` switch.
- `judgeStandard(runCommand, testcase, timeoutMs)` — drop the `compare?` parameter.
- `compareOutputs(actual, expected)` becomes:
  ```ts
  function normalize(s: string): string {
    return s
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/\n+$/, "");
  }
  function compareOutputs(actual: string, expected: string): boolean {
    return normalize(actual) === normalize(expected);
  }
  ```
- Note: the round-5 elegance pass flagged that the previous `trimTrailingWhitespace` only stripped the end of the whole string, not per line. The new `normalize()` fixes that as a side effect.

### Why

Matches the canonical OJ behavior. No mode = no choice paralysis. Float / regex / case-insensitive cases route to a checker, where the author has full control.

## Feature: Subtask Scoring Strategy on `TestcaseSet`

### Schema change

`packages/db/prisma/schema/problem.prisma`:

```prisma
enum SubtaskScoringStrategy {
  ALL_OR_NOTHING
  PROPORTIONAL
  MINIMUM
}

model TestcaseSet {
  // … existing fields …
  scoringStrategy SubtaskScoringStrategy @default(ALL_OR_NOTHING)
}
```

### Migration

New migration directory `packages/db/prisma/migrations/20260413000000_subtask_scoring_strategy_column/`:

1. `CREATE TYPE "SubtaskScoringStrategy" AS ENUM (...)`
2. `ALTER TABLE "TestcaseSet" ADD COLUMN "scoringStrategy" "SubtaskScoringStrategy" NOT NULL DEFAULT 'ALL_OR_NOTHING'`
3. **Data migration** (raw SQL, runs in the same migration): for every row in `Problem` whose `judgeConfig` JSON has `scoring.subtaskStrategies`, walk the `(setId, strategy)` pairs and `UPDATE "TestcaseSet" SET "scoringStrategy" = ... WHERE id = ...`. Then strip `scoring` and `compare` from the `judgeConfig` JSON.
4. After data migration, no further structural change — `judgeConfig` JSON simply no longer has those keys; zod will silently drop unknown fields anyway, but explicit cleanup avoids confusion in DB inspectors.

### Schema layer (`@nojv/core`)

`packages/core/src/schemas/judge-config.ts`:

- Delete `compareModeSchema`, `CompareMode`, `compareSchema`, `Compare`.
- Delete `judgeScoringSchema`, `JudgeScoring`.
- Delete `judgeConfigSchema.compare` and `judgeConfigSchema.scoring`.
- `judgeScriptLanguageSchema` becomes `z.enum(["python", "cpp"])`.

### Domain layer

`packages/application/src/submission/judge-context.ts`:

- Build `subtaskStrategies` from the `testcaseSets` query result instead of from `judgeConfig.scoring.subtaskStrategies`. The set-by-id map shape is unchanged, so downstream consumers (`scoring.ts`) are unaffected.
- The repository `getProblemForJudging` (or equivalent) must include `scoringStrategy` in its `select`.

### Repository

`packages/db/src/repositories/testcase-set.ts` (or wherever the existing CRUD lives) gains:

```ts
async updateScoringStrategy(setId: string, strategy: SubtaskScoringStrategy): Promise<void>
```

## Feature: UI Relocation

### `TestcaseTab.svelte` — strategy picker on each subtask card

`TestcaseSetCard` (the existing per-set card) gets a new row beneath name/weight: a `<select>` for `scoringStrategy`, with a `HelpTooltip` explaining the three modes:

- **全對才給分 (`ALL_OR_NOTHING`)** — 任一 testcase fail → 子任務 0 分。
- **按比例 (`PROPORTIONAL`)** — 子任務分數 = pass / total × weight。
- **取最低 (`MINIMUM`)** — 子任務分數 = min(各 testcase 分數) × weight / 100。適合 checker 回報部分分數。

Selecting a value POSTs to a new `?/updateTestcaseSetScoring` action on `apps/web/src/routes/(app)/problems/[id]/edit/+page.server.ts`, which calls `problemDomain.assertProblemEditAccess` then the new repository method. Optimistic update + toast on success.

A small **總分公式預覽** strip below the subtask list (moved from the Judge tab):
`Subtask 1 (50pts, proportional) + Subtask 2 (50pts, all-or-nothing)`

### `JudgeTab.svelte` — drastically slimmed

Three radio buttons (standard / checker / interactive) remain. Below them:

- **Standard branch:** the entire `compareMode` select + float tolerance grid + regex textarea **deleted**. Replaced by a one-line note: _"輸出將套用標準 OJ 正規化：CRLF→LF、每行去尾空白、尾端空白行忽略。如需浮點容差或自訂比對，請改用 Checker。"_
- **Checker / Interactive branches:** language select (Python / C++ only), Monaco editor, plus a new **collapsible documentation panel** above the editor (see next section).
- **Subtask Scoring section:** entire `<div>` with `formulaPreview`, `subtaskStrategies` state, and `set` iteration **deleted**.
- `buildJudgeConfig` returns `{ type, runtime, [checkerScript, checkerLanguage] | [interactorScript, interactorLanguage] }` — no `compare`, no `scoring`.

### Paraglide messages

Delete: `admin_compareMode`, `admin_compareModeExact`, `admin_compareModeIgnoreWhitespace`, `admin_compareModeIgnoreCase`, `admin_compareModeFloat`, `admin_compareModeRegexFilter`, `admin_absoluteTolerance`, `admin_relativeTolerance`, `admin_ignoreLinesLabel`, `admin_subtaskScoring`, `admin_subtaskScoringHint`, `admin_noGradedSets`, `admin_totalScoreLabel`, `admin_scoringAllOrNothing`, `admin_scoringProportional`, `admin_scoringMinimum`.

Add: `admin_standardNormalizationHint`, `admin_checkerHelpTitle`, `admin_checkerHelpBody`, `admin_interactorHelpTitle`, `admin_interactorHelpBody`, `testcases_scoringStrategy`, `testcases_scoringStrategyAllOrNothing`, `testcases_scoringStrategyProportional`, `testcases_scoringStrategyMinimum`, `testcases_scoringStrategyHint`, `testcases_totalScoreLabel`.

(Both en and zh-TW; the script code samples themselves are not internationalized — they live as static `.ts` constants and only contain code, not UX copy.)

## Feature: Checker / Interactor DX

### Prior art surveyed

| OJ                   | Checker API                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Codeforces / Polygon | C++ `testlib.h` — `registerTestlibCmd(argc, argv)`, `inf/ouf/ans.readInt()`, `quitf(_ok/_wa, "...")`, `quitp(points, "...")`                   |
| DMOJ                 | Python — user defines `def check(process_output, judge_output, judge_input=None, **kwargs):` returning `CheckerResult(True, points, feedback)` |
| DOMjudge / Kattis    | Any language — exit code 42 = AC, 43 = WA, feedback to fd 3                                                                                    |
| UOJ / LOJ            | C++ `testlib.h`                                                                                                                                |

The `testlib.h` ecosystem is the de facto standard for C++. DMOJ's "just write a function" model is the cleanest for Python.

### C++: bundle `testlib.h`

- Source: `apps/sandbox-runner/assets/testlib/testlib.h` + `apps/sandbox-runner/assets/testlib/LICENSE` (MIT, copied verbatim from upstream).
- Sandbox image Dockerfile copies `testlib.h` to `/usr/include/testlib.h`.
- Add `apps/sandbox-runner/assets/testlib/README.md` noting the upstream URL, commit pinned, and update procedure.
- Add a line to a top-level `THIRD_PARTY_NOTICES.md` (create if missing).
- The compile step (existing `apps/sandbox-runner/src/compiler.ts`) does not need to change for C++ — `g++ checker.cpp` already finds `/usr/include/testlib.h`.
- Documentation panel for C++ shows a checker example using `inf/ouf/ans` + `quitf` and an interactor example using `registerInteraction` + `cout/cin`. Includes a link to the [official testlib tutorial](https://codeforces.com/blog/entry/18431).

### Python: auto-prepend a wrapper

`apps/sandbox-runner/src/compiler.ts` (or wherever the `python` compile step writes the script file) gains a step: when `mode === "checker"` or `mode === "interactive"` and `language === "python"`, prepend the corresponding template before writing.

**Checker wrapper** (`apps/sandbox-runner/assets/wrappers/python-checker.py`):

```python
import sys as _sys
judge_input = open(_sys.argv[1]).read()
judge_output = open(_sys.argv[2]).read()
process_output = open(_sys.argv[3]).read()

def accept(feedback=""):
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(0)

def reject(feedback=""):
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(1)

def partial(score, feedback=""):
    print(int(score))
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(0 if score >= 100 else 1)

# --- your code below ---
```

**Interactor wrapper** (`apps/sandbox-runner/assets/wrappers/python-interactor.py`):

```python
import sys as _sys
judge_input = open(_sys.argv[1]).read()

def read():
    line = _sys.stdin.readline()
    if not line: _emit(0, "student closed stream early", 1)
    return line.rstrip("\n")

def write(msg):
    print(msg, flush=True)

def accept(feedback="", score=100):
    _emit(score, feedback, 0)

def reject(feedback="", score=0):
    _emit(score, feedback, 1)

def partial(score, feedback=""):
    _emit(score, feedback, 0 if score >= 100 else 1)

def _emit(score, feedback, code):
    print(int(score), file=_sys.stderr)
    if feedback: print(feedback, file=_sys.stderr)
    _sys.exit(code)

# --- your code below ---
```

The trailing `# --- your code below ---` line is purely cosmetic — concatenation appends user code immediately after.

### Documentation panel content

The panel is a `<details>` element above the Monaco editor. Title: "如何撰寫此腳本".

**Checker panel:**

> Sandbox 會以下列方式呼叫你的腳本（C++ 透過 `testlib.h` 自動處理；Python 已注入下列變數與輔助函式）：
>
> | 變數             | 內容         |
> | ---------------- | ------------ |
> | `judge_input`    | 測資輸入內容 |
> | `judge_output`   | 標準答案內容 |
> | `process_output` | 學生輸出內容 |
>
> | 函式                          | 行為                                                          |
> | ----------------------------- | ------------------------------------------------------------- |
> | `accept(feedback="")`         | 此測資 AC，回饋顯示給學生                                     |
> | `reject(feedback="")`         | 此測資 WA                                                     |
> | `partial(score, feedback="")` | 部分分數 (0–100)，搭配 `MINIMUM` 或 `PROPORTIONAL` 子任務策略 |
>
> Checker 超時上限 30 秒。掛掉或逾時記為 SE，不影響學生判決。

Then a runnable Python example (浮點比對) and a runnable C++ example (token 比對 + `quitf(_wa, ...)` / `quitf(_ok, ...)`).

**Interactor panel:**

> Sandbox 會把學生程式與 interactor 雙向接管道：
>
> ```
> 學生 stdout ──▶ interactor stdin
> interactor stdout ──▶ 學生 stdin
> ```
>
> Python 已注入：
>
> | 函式                            | 行為                                                     |
> | ------------------------------- | -------------------------------------------------------- |
> | `read()`                        | 讀學生送來的一行（自動去掉 `\n`，學生中止時自動 reject） |
> | `write(msg)`                    | 寫一行給學生（已自動 flush）                             |
> | `accept` / `reject` / `partial` | 同 checker，但 score 寫到 stderr 第 1 行                 |
>
> C++ 用 `registerInteraction(argc, argv)` + `cout`/`cin`，記得 `cout << flush` 後再讀。
>
> Interactor 共享題目的時間限制（學生 + interactor 總用時）。

Then runnable Python interactor example (猜數字) and C++ equivalent.

Both example bodies live as `const PYTHON_CHECKER_EXAMPLE = "..."`-style constants in `apps/web/src/lib/components/problem/tabs/judge/script-examples.ts`, imported by `JudgeTab.svelte`.

## Implementation order

1. Schema + migration (`@nojv/db`, `@nojv/core`) — must land first because everything else depends on the type changes.
2. Domain `judge-context.ts` change — read `scoringStrategy` from joined sets.
3. `sandbox-runner/standard.ts` — drop compare param.
4. `sandbox-runner/compiler.ts` — Python wrapper injection.
5. Sandbox image Dockerfile — copy `testlib.h`.
6. Repository `updateScoringStrategy` + new server action.
7. `TestcaseTab.svelte` / `TestcaseSetCard.svelte` — add strategy picker.
8. `JudgeTab.svelte` — slim down + add documentation panel.
9. Paraglide messages add/remove + recompile.
10. Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, manual sandbox run with each of (standard / python checker / cpp checker / python interactor / cpp interactor).

## Risks and mitigations

- **Existing problems with `judgeConfig.compare.mode = "float"`** silently downgrade to canonical normalization. Mitigation: data migration logs (via `RAISE NOTICE` or stdout) any problem id that previously had a non-`exact` compare mode so the operator can audit and migrate critical problems to checkers manually if needed.
- **Existing checkers/interactors written in bash/node/c** become uncompilable. Mitigation: data migration `RAISE NOTICE`s any problem with `judgeConfig.checkerLanguage` ∈ `{bash, node, c}` or same for interactor. These problems will need to be ported to Python or C++ before re-judging works. The current checker count is small enough that manual migration is realistic — to be confirmed against production data before running the migration.
- **`testlib.h` upstream updates** must be tracked manually. Mitigation: pin a commit SHA in `apps/sandbox-runner/assets/testlib/README.md` and document the update procedure (`curl` + verify checksum).
- **Python wrapper line numbers shift error tracebacks.** Mitigation: prepend with a fixed-size header (currently ~25 lines) and document in the help panel: "若 traceback 行號比你的程式多 25 行，那是 sandbox 注入的輔助程式碼。"
