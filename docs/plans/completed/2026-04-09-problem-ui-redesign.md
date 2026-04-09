# Problem Creation UI Redesign

**Date:** 2026-04-09
**Status:** Completed (2026-04-10)
**Supersedes:** parts of `completed/2026-04-03-problem-config-redesign.md`

**Completion notes:** All 8 phases landed on branch `phase1-problem-ui-redesign`. Follow-ups also closed: convert-to-advanced escape hatch, workspace file quota enforcement, full `compare.mode` implementation (all 5 modes), advanced-mode docker dispatch, tarball upload endpoint, `JUDGE_PIPELINE.md` rewrite, seed demo data for samples/workspace files/advanced mode/adjustment rules, e2e coverage for advanced-mode lifecycle, and several dead-code sweeps (`ProblemTemplate`, `TestcaseSet.isHidden`, `buildNetworkArgs`, function-mode template injection tests). Pre-existing 12 svelte-check warnings fixed along the way.

## Goals

1. Replace the current 5-tab flat form with a **4-section** Standard Mode that mirrors how problem setters actually think (problem → workspace → testcases → judgment).
2. Unify the two current overlapping concepts `ProblemTemplate` (function-mode driver code) and ad-hoc teacher assets into a single **Workspace file** model with per-file visibility and optional editable regions.
3. Keep simple problems truly simple while still supporting library-style problems with hidden/readonly teacher files.
4. Move adjustment rules (late penalty, time bonus, memory penalty) out of per-problem config and into **assignment-level** settings, which is where they semantically belong.
5. Provide an **Advanced Mode** escape hatch for problems that need custom environments or evaluation pipelines — implemented as a container contract, not as an extension of the Standard Mode schema.

## Non-goals

- No inline Dockerfile editing in Standard Mode.
- No visual pipeline editor. The pipeline is implicit and fixed.
- No CLI / git-based authoring. All problem editing happens through the web UI.
- No binary file testcases in Standard Mode. Text-only stdin/stdout.
- No `function`-mode templates with hidden driver code. Students always submit the editor's full contents; partial editing is expressed via editable regions instead.
- No per-problem late penalty or scoring adjustments. These move to assignment-level.

## Design decisions

Each decision below was made deliberately during the redesign discussion; the rationale matters for judging future trade-offs.

### Standard Mode has exactly 4 sections

```
📝 Statement      problem presentation (title, description, I/O format, samples)
💻 Workspace      execution setup (limits, env, allowed languages, files)
🧪 Testcases      graded testcase sets (subtasks)
⚖️ Judge          per-case verdict method + subtask scoring strategy
```

Alternatives considered and rejected:

- **5 tabs with Scoring separate** — Scoring only holds subtask strategies after removing adjustments and custom scripts, so it is small enough to live at the bottom of Judge.
- **6 sections with Execution split from Workspace** — Adds a tab the user rarely visits; limits/env live naturally next to the files they affect.
- **Pipeline editor with stage cards** — Overengineered; TAs do not think in terms of pipelines for simple problems.

### Samples belong in Statement, not in Testcases

Sample I/O pairs are **problem presentation**, not grading data. They render inline on the student-facing problem page alongside the description. Standard Mode stores them as a `samples: Json` column on `Problem`, not as a specially-flagged `TestcaseSet`. This removes the `isHidden` column and the `sample | graded` mode distinction entirely — every `TestcaseSet` in the database is a graded subtask.

### Workspace files unify templates and teacher assets

Previous attempts treated these as separate concepts:

- `ProblemTemplate` — function-mode driver code with hidden `driverCode` and insertion markers
- Teacher assets — hidden files packed into the sandbox

The new model is one table, `ProblemWorkspaceFile`, with a `visibility` enum:

| Visibility | Shown to student | Student can edit                  | Present in sandbox |
| ---------- | ---------------- | --------------------------------- | ------------------ |
| `editable` | ✓                | ✓ (optionally limited to regions) | ✓                  |
| `readonly` | ✓ (greyed out)   | ✗                                 | ✓                  |
| `hidden`   | ✗                | ✗                                 | ✓                  |

This single model expresses every case we need:

- Single-file stdin/stdout problem: one `editable` `main.c`.
- LeetCode-style fill-in-the-body: one `editable` file with `editableRegions: [[10, 15]]`, the rest locked.
- Library problem (HW03.1 Riemann): `riemann.c` editable, `riemann.h` readonly, `main.c` and `Makefile` hidden.
- Multi-file refactoring task: multiple editable files, some with region restrictions.

There are no insertion markers, no hidden wrapping code, no driver injection. When the student submits, the server takes the current contents of editable files, merges them with the readonly+hidden files, and sends the whole tree to the sandbox.

### Judge type stays as radio — not expanded into a pipeline

The three judge types (`standard` / `checker` / `interactive`) are mutually exclusive and well-understood. Each brings its own configuration (compare mode for standard, script editor for checker/interactive). No need to treat them as pipeline steps.

### Adjustment rules move to assignment level

`late_penalty_fixed`, `late_penalty_decay`, `time_bonus`, and `memory_penalty` are **assignment-level policies** (one set of rules for a whole homework, applied uniformly). They were incorrectly placed in `Problem.judgeConfig.scoring.adjustmentRules`. Moving them to `CourseAssessment` and `Contest` better reflects how instructors actually assign penalties.

### Advanced Mode is a separate, narrow escape hatch

For problems that truly need custom environments (e.g., HW02.5 Tmux, ML grading, image diffing), Standard Mode is insufficient no matter how many knobs we add. Rather than piling features onto Standard Mode, Advanced Mode defines a minimal **container contract**: TA provides an image, the platform hands it student files and testcases in well-known paths, the image writes a `result.json`, and the platform reads the score. All pipeline complexity lives inside the TA's image, not in our schema.

Standard Mode and Advanced Mode share only the Statement section. They have incompatible workspaces, testcase models, and judging models — switching between them after creation is a one-way, data-lossy operation.

## Standard Mode spec

### 1. Statement section

**Purpose:** everything visible to the student on the problem page.

**Fields:**

- `title: string` (1–120)
- `statement: markdown` (≤12k, i18n per locale)
- `inputFormat: string` (≤4k)
- `outputFormat: string` (≤4k)
- `difficulty: enum`
- `visibility: enum`
- `tags: string[]` (≤20)
- `summary: string` (≤2k, advanced collapse)
- `samples: { stdin: string, expected: string }[]` (0–5 pairs)

**UI:** a single form, samples edited as a flat list below the statement markdown.

**Save action:** `?/updateStatement`.

### 2. Workspace section

**Purpose:** everything about how student code runs.

**Subsections:**

**2.1 Runtime**

- `timeLimitMs: int` (100–30000)
- `memoryLimitMb: int` (16–1024)
- `env: Record<string, string>` (static key-value list, no parameterization)

**2.2 Languages**

- `allowedLanguages: SupportedLanguage[]` (multi-select)

**2.3 Files per language**
Each `ProblemWorkspaceFile` row has:

- `language: SupportedLanguage`
- `path: string` — may contain `/` for folders (flat UI list, TA types full path)
- `content: string` (≤200k)
- `visibility: "editable" | "readonly" | "hidden"`
- `editableRegions: [[startLine, endLine], ...]?` — only meaningful when `visibility === "editable"`; absent means the whole file is editable

**UI:** left pane shows a flat file list filtered by selected language tab; right pane shows a Monaco editor for the selected file, with a `Visibility` dropdown and an editable-regions editor (TA highlights a range and clicks "Mark as editable region").

**Save action:** `?/updateWorkspace`.

### 3. Testcases section

**Purpose:** the graded testcase data used for final scoring.

**Fields per `TestcaseSet`:**

- `name: string`
- `weight: int` (> 0; zero-weight sets are not allowed here — samples live in Statement)

**Fields per `Testcase`:**

- `ordinal: int`
- `stdin: string` (≤200k, **text only**)
- `expectedStdout: string | null` (≤200k, null allowed when judge type is `checker` or `interactive`)

**UI:** existing testcase set card layout, minus the sample-set visibility toggle. Top banner displays the current judge type pulled from `judgeConfig.type` with a warning if changing judge type would invalidate `expectedStdout` requirements.

**Save:** inline (existing pattern).

### 4. Judge section

**Purpose:** per-case verdict + subtask scoring.

**Subsection 4.1: Judge Type** (radio)

- `standard`: compare stdout to expected
  - `compare.mode: enum` (`exact` / `ignore_whitespace` / `ignore_case` / `float` / `regex_filter`)
  - `compare.floatAbsTol: number?` (when `mode === "float"`)
  - `compare.floatRelTol: number?` (when `mode === "float"`)
  - `compare.ignoreLinePatterns: string[]?` (when `mode === "regex_filter"`)
- `checker`: teacher-provided script
  - `checkerScript: string`
  - `checkerLanguage: "bash" | "python" | "node" | "c" | "cpp"`
- `interactive`: teacher-provided interactor
  - `interactorScript: string`
  - `interactorLanguage: "bash" | "python" | "node" | "c" | "cpp"`

**Subsection 4.2: Subtask Scoring**

- `subtaskStrategies: Record<testcaseSetId, "all_or_nothing" | "proportional" | "minimum">`
- Live formula preview based on current testcase sets and selected strategies.

**Save action:** `?/updateJudge`.

### Removed from Standard Mode

Explicitly not present:

- Static analysis (banned functions, linters, AST rules)
- Artifact collection
- Network access configuration
- Custom pipeline stage scripts (before/after compile, etc.)
- Custom scoring script
- Late penalty / time bonus / memory penalty
- Dockerfile / base image selection
- Function-mode templates (replaced by editable regions)
- Per-testcase input/expected files (text only)

Anything in this list either moves to Advanced Mode or to assignment-level settings.

## Advanced Mode spec

### Purpose

Problems that cannot fit Standard Mode's model. The TA provides a container image that owns the entire grading logic. The platform only standardizes the input/output interface.

### Sections (3)

1. **📝 Statement** — same schema as Standard Mode.
2. **🐳 Image** — image source (approved-registry tag or uploaded tarball), resource limits, contract docs.
3. **🧪 Testcases** — each case is a bag of arbitrary files.

### Container contract

When the platform judges an Advanced Mode submission, it starts the TA's image with this filesystem layout:

```
/workspace/
├── submission/           student-submitted files (extracted ZIP or single file)
├── testcases/
│   ├── 0/
│   │   ├── stdin         text, may be empty
│   │   ├── expected      optional text reference
│   │   └── files/        arbitrary additional files for this case
│   ├── 1/
│   └── ...
├── meta.json             { numTestcases, language, submissionFiles }
└── output/               TA's image writes here
    ├── result.json       required
    └── artifacts/        optional collected files
```

### `result.json` schema

```jsonc
{
  "score": 0..100,
  "verdict": "accepted" | "wrong_answer" | "runtime_error" | "time_limit_exceeded" | ...,
  "feedback": "human-readable string",
  "testcases": [
    { "index": 0, "verdict": "AC", "runtimeMs": 120, "feedback": "..." },
    ...
  ],
  "subtasks": [
    { "name": "sample", "score": 100, "passed": true },
    ...
  ]
}
```

Missing or malformed `result.json` → overall verdict `SE` (system error).

### Student submission

Advanced Mode problems accept **only** ZIP uploads from students (or single file uploads that the platform wraps). There is no in-browser editor for Advanced Mode problems.

### Access

Advanced Mode is selected via a link at the bottom of the "Create Problem" dialog:

> 需要多檔案、複雜評分流程、或自訂環境？
> [🔧 嘗試更複雜的題目設計 →]

Standard Mode pages also have a "convert to Advanced Mode" link at the bottom, with a warning that Workspace / Judge / Scoring settings will be discarded in the conversion.

## Database schema changes

### New: `ProblemWorkspaceFile`

```prisma
enum WorkspaceFileVisibility {
  editable
  readonly
  hidden
}

model ProblemWorkspaceFile {
  id              String                   @id @default(cuid())
  problemId       String
  language        SupportedLanguage
  path            String                   // "main.c", "include/riemann.h"
  content         String                   @db.Text
  visibility      WorkspaceFileVisibility
  editableRegions Json?                    // [[10,15], [25,40]] or null
  orderIndex      Int                      @default(0)
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  problem         Problem                  @relation(fields: [problemId], references: [id], onDelete: Cascade)

  @@unique([problemId, language, path])
  @@index([problemId, language])
}
```

### Modified: `Problem`

Add:

- `samples: Json?` — `{ stdin: string, expected: string }[]`
- `mode: enum(standard, advanced)` — defaults to `standard`
- `advancedImageRef: String?` — registry tag or storage path for Advanced Mode
- `advancedImageSource: enum(registry, tarball)?`

Shrink `judgeConfig` JSON shape. The new minimal schema:

```ts
{
  type: "standard" | "checker" | "interactive",
  compare?: {
    mode: "exact" | "ignore_whitespace" | "ignore_case" | "float" | "regex_filter",
    floatAbsTol?: number,
    floatRelTol?: number,
    ignoreLinePatterns?: string[],
  },
  checkerScript?: string,
  checkerLanguage?: string,
  interactorScript?: string,
  interactorLanguage?: string,
  runtime: {
    timeLimitMs: number,
    memoryLimitMb: number,
    env: Record<string, string>,
  },
  scoring: {
    subtaskStrategies: Record<string, "all_or_nothing" | "proportional" | "minimum">
  }
}
```

Top-level `Problem.timeLimitMs` / `memoryLimitMb` are kept as caches; the authoritative values live in `judgeConfig.runtime`.

### Removed: `ProblemTemplate`

Replaced entirely by `ProblemWorkspaceFile`. Migration: see below.

### Modified: `TestcaseSet`

Drop the `isHidden` column. Every `TestcaseSet` is now a graded subtask; sample I/O lives in `Problem.samples`.

### Modified: `CourseAssessment` and `Contest`

Add:

- `adjustmentRules: Json?` — array of the 4 existing rule types (`late_penalty_fixed`, `late_penalty_decay`, `time_bonus`, `memory_penalty`)

Assessment and contest workflows apply these rules when computing the final score, replacing the per-problem adjustment pipeline.

### Removed fields from `judgeConfig`

All of the following are removed from `Problem.judgeConfig` and their backing code deleted:

- `staticAnalysis`
- `artifacts`
- `networkAccess`
- `customScripts`
- `scoring.adjustmentRules`
- `scoring.script` / `scoring.language` / `scoring.timeoutMs`
- `pipeline` (stage array)

Existing data in these fields is discarded during migration (see migration plan below).

## Migration plan

### Data migration

1. **Samples:** for every `TestcaseSet` where `isHidden = false` (samples in the old model), copy its cases into `Problem.samples` as `{ stdin, expected }`, then delete those sets.
2. **Workspace files from templates:** for every `ProblemTemplate`, create one `ProblemWorkspaceFile` with `visibility = editable`, `path = "main.<ext>"`, and `content = templateCode`. Discard `driverCode` and `insertionMarker` — these would need manual rework by the TA if the problem genuinely needs hidden driver code.
3. **Adjustment rules:** for every `Problem.judgeConfig.scoring.adjustmentRules` that is non-empty, warn the problem owner and link the rules into the `CourseAssessment` / `Contest` that uses the problem (if unambiguous). Problems linked to multiple assessments require manual migration.
4. **Removed judgeConfig fields:** drop `staticAnalysis`, `artifacts`, `networkAccess`, `customScripts`, `scoring.script`. These are not auto-migrated; problems depending on them must either be redesigned for Standard Mode or converted to Advanced Mode by hand.

Migration is a one-shot script run during deployment. No runtime dual-read compatibility is planned.

### Runner changes

`packages/temporal/src/activities/judge.ts::executeSandbox` currently reads `testcaseSets` and filters by `isHidden` when `draft.sampleOnly` is set. Change:

```ts
const testcases = draft.sampleOnly
  ? (problem.samples ?? []).map((s, i) => ({
      index: i, input: s.stdin, expected: s.expected, weight: 0, isSample: true
    }))
  : judgeContext.testcaseSets.flatMap(...);
```

Runtime config (`env`, `timeLimitMs`, `memoryLimitMb`) is read from `judgeConfig.runtime` instead of `Problem` top-level.

The fake subtask strategy implementation (`buildSubtaskResults` hard-coding `all_or_nothing`) must be fixed to honor `judgeConfig.scoring.subtaskStrategies` for real.

### Assessment-level adjustment application

`apps/worker/src` or equivalent assessment/contest workflows gain a post-score-adjustment step that reads the assessment/contest's `adjustmentRules` and applies them to the submission's raw score. This is where late penalties and bonuses are computed.

## Component changes

### Delete

- `apps/web/src/lib/components/problem/tabs/SubmissionTab.svelte`
- `apps/web/src/lib/components/problem/tabs/judge/StaticAnalysisSection.svelte`
- `apps/web/src/lib/components/problem/tabs/judge/ArtifactsSection.svelte`
- `apps/web/src/lib/components/problem/tabs/judge/NetworkSection.svelte`
- `apps/web/src/lib/components/problem/tabs/judge/CustomScriptsSection.svelte`
- `apps/web/src/lib/components/problem/tabs/ScoringTab.svelte` (merged into Judge)

### Modify

- `apps/web/src/lib/components/problem/ProblemTabs.svelte` → `ProblemSections.svelte` (4 sections, left nav instead of top tabs)
- `apps/web/src/lib/components/problem/tabs/BasicInfoTab.svelte` → `StatementSection.svelte` (add samples editor)
- `apps/web/src/lib/components/problem/tabs/TestcaseTab.svelte` → `TestcasesSection.svelte` (remove sample-set UI, add judge-type banner)
- `apps/web/src/lib/components/problem/tabs/JudgeTab.svelte` → `JudgeSection.svelte` (strip out everything except judge type + compare + checker/interactor + subtask strategies)
- `apps/web/src/lib/components/problem/CodeTemplateEditor.svelte` → expand into `WorkspaceFileEditor.svelte` (supports visibility + editable regions)

### New

- `apps/web/src/lib/components/problem/sections/WorkspaceSection.svelte` (runtime + env + languages + files)
- `apps/web/src/lib/components/problem/workspace/WorkspaceFileList.svelte`
- `apps/web/src/lib/components/problem/workspace/WorkspaceFileEditor.svelte`
- `apps/web/src/lib/components/problem/workspace/MonacoEditableRegions.svelte` (wraps Monaco with read-only decorations outside editable ranges)
- `apps/web/src/lib/components/problem/statement/SamplesEditor.svelte`
- `apps/web/src/lib/components/problem/AdvancedModeSwitch.svelte` (entry on Create dialog + escape hatch on Standard Mode page footer)
- `apps/web/src/lib/components/problem/advanced/ImageSection.svelte` (registry tag / tarball upload)
- `apps/web/src/lib/components/problem/advanced/AdvancedTestcasesSection.svelte` (file-bag per case)

### Monaco editable regions implementation note

Monaco supports read-only ranges via `model.onDidChangeContent` guarding and `editor.deltaDecorations` for visual marking. The `MonacoEditableRegions` component takes `value`, `editableRegions: [startLine, endLine][]`, and emits `onChange` only when edits occur within declared ranges. Out-of-range edits are reverted and flashed with a warning decoration. LeetCode uses exactly this pattern.

## Save action mapping

| Section   | Action              | Writes to                                                                                                |
| --------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| Statement | `?/updateStatement` | `Problem` (metadata + samples), `ProblemStatementI18n`                                                   |
| Workspace | `?/updateWorkspace` | `Problem.judgeConfig.runtime`, `Problem` allowed-languages cache, `ProblemWorkspaceFile` (upsert/delete) |
| Testcases | inline              | `TestcaseSet`, `Testcase`                                                                                |
| Judge     | `?/updateJudge`     | `Problem.judgeConfig.type` / `compare` / scripts / `scoring.subtaskStrategies`                           |

## Implementation phases

### Phase 1 — Schema foundation

- Add `ProblemWorkspaceFile` table.
- Add `Problem.samples`, `Problem.mode`, `Problem.advancedImageRef`, `Problem.advancedImageSource`.
- Add `CourseAssessment.adjustmentRules`, `Contest.adjustmentRules`.
- Drop `TestcaseSet.isHidden`.
- Migration script for: sample extraction from `TestcaseSet` → `Problem.samples`, `ProblemTemplate` → `ProblemWorkspaceFile`, `judgeConfig.scoring.adjustmentRules` → assessment-level (with warnings for ambiguous cases).
- Keep the `ProblemTemplate` table in place for now; deletion happens in Phase 5.

### Phase 2 — Runner updates

- Fix `buildSubtaskResults` to honor `subtaskStrategies`.
- Change `executeSandbox` to read `judgeConfig.runtime` (env, limits).
- Change `sampleOnly` path to read `Problem.samples` instead of `!isHidden` filter on testcase sets.
- Teach the runner to merge `ProblemWorkspaceFile` entries (all visibilities) with the student submission when building the sandbox workspace.
- Add assessment/contest score adjustment step.

### Phase 3 — Statement section + samples

- Rename `BasicInfoTab` → `StatementSection`.
- Add `SamplesEditor` component and wire into Statement form.
- Student problem page renders samples below statement.

### Phase 4 — Workspace section

- Build `WorkspaceSection`, `WorkspaceFileList`, `WorkspaceFileEditor`.
- Build `MonacoEditableRegions` with proper read-only enforcement.
- Migrate existing `ProblemTemplate` usages to read from `ProblemWorkspaceFile`.
- Student editor loads workspace files, respects visibility and editable regions.

### Phase 5 — Testcases + Judge rework

- Strip sample handling from `TestcaseTab`.
- Rebuild `JudgeTab` as `JudgeSection` with only judge type + compare + scripts + subtask strategies.
- Delete `StaticAnalysisSection`, `ArtifactsSection`, `NetworkSection`, `CustomScriptsSection`, `ScoringTab`, `SubmissionTab`.
- Delete `ProblemTemplate` table and related code.

### Phase 6 — Nav restructure

- Replace `ProblemTabs` with `ProblemSections` (left nav).
- Reconcile save flows per section.
- Add dirty-state warnings across sections.

### Phase 7 — Advanced Mode

- Container registry integration for approved images.
- Image tarball upload pipeline.
- Runner: Advanced Mode code path that mounts `/workspace` according to the container contract and reads `result.json`.
- UI: `AdvancedModeSwitch`, `ImageSection`, `AdvancedTestcasesSection`.
- Entry point on Create dialog and Standard Mode footer link.

### Phase 8 — Assessment-level adjustments UI

- Add adjustment-rules editor to `CourseAssessment` and `Contest` creation/edit pages.
- Remove all adjustment-rule UI from problem pages.

## Open questions

- Does the current `CourseAssessment` / `Contest` UI already surface a penalty configuration area, or does one need to be built from scratch? Check `apps/web/src/routes/(app)/courses/[slug]/manage/assessments/+page.server.ts`.
- Is the Advanced Mode container registry internal (built alongside NOJV) or a hosted service? This decision affects the Phase 7 scope.
- What is the maximum practical size for a single `ProblemWorkspaceFile.content`? `@db.Text` holds arbitrary length, but the API and UI should enforce a soft limit (proposed: 200 KB per file, 1 MB total per problem-language pair).

## Related

- Supersedes adjustment-rule and custom-script parts of `completed/2026-04-03-problem-config-redesign.md` and `completed/2026-04-03-problem-config-implementation.md`.
- Supersedes `completed/2026-04-01-cp-problem-judge-mapping.md` analysis for Standard Mode scope (Advanced Mode now covers the outliers).
- `docs/JUDGE_PIPELINE.md` will need to be rewritten when Phase 5 lands to reflect the simplified pipeline and the Standard/Advanced split.
