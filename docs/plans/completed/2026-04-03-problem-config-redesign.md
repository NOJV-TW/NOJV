# Problem Configuration Redesign

> Date: 2026-04-03
> Status: Design Complete
>
> **Note:** After this plan was written, the Problem model's `slug` field was removed. Problems are now identified by `id` in routes (e.g., `/problems/[id]`, `/problems/[id]/edit`).

## Background

The current problem creation/editing experience has several pain points:

1. **Schema fragmentation** — 8 judge-related fields scattered across the Problem table (`judgeType`, `checkerScript`, `interactorScript`, `scoringScript`, `scoringLanguage`, `artifactPatterns`, `networkAccessConfig`, `pipelineConfig`)
2. **Missing UI** — Advanced pipeline features (custom scoring, static analysis, artifact collection, network access) have no frontend interface
3. **Poor UX** — All settings crammed into a single long form, no separation of concerns
4. **Testcase management gaps** — No edit/delete for existing testcases, unintuitive ZIP+subtask flow, can't see existing testcases when editing

This redesign addresses all four issues simultaneously.

## Target Users

- **Teachers**: Create standard problems quickly. Only need basic info + testcases + default judging.
- **Advanced users (problem setters)**: Full control over judge pipeline — custom checkers, static analysis, scoring scripts, network access, artifacts.

## Schema Consolidation

### Unified `judgeConfig`

Replace 8 scattered fields with a single `judgeConfig` JSON column:

```typescript
// packages/core/src/schemas/judge-config.ts

const judgeConfigSchema = z.object({
  // === Core judging (required) ===
  type: judgeTypeSchema, // "standard" | "checker" | "interactive"
  checkerScript: z.string().max(200_000).optional(),
  interactorScript: z.string().max(200_000).optional(),

  // === Custom scoring (optional) ===
  scoring: scoringConfigSchema.optional(), // { script, language, timeoutMs }

  // === Pipeline override (optional, defaults to compile→execute→check) ===
  pipeline: z
    .object({
      stages: z.array(pipelineStageSchema).min(1).max(20)
    })
    .optional(),

  // === Advanced features (optional) ===
  staticAnalysis: staticAnalysisConfigSchema.optional(),
  artifacts: artifactConfigSchema.optional(),
  networkAccess: networkAccessConfigSchema.optional()
});
```

### DB Changes

**Problem table**:

- Remove: `judgeType`, `checkerScript`, `interactorScript`, `scoringScript`, `scoringLanguage`, `artifactPatterns`, `networkAccessConfig`, `pipelineConfig`
- Add: `judgeConfig Json?` (unified config)
- Add: `status String` (`draft` | `published`) for draft workflow
- Keep: `timeLimitMs`, `memoryLimitMb`, `submissionType` (execution limits, not judge logic)

**SubmissionType enum**:

- Add: `zip_project`

**seed.ts**: Update to use new `judgeConfig` field.

No migration needed — direct schema update.

## UI Design: 5 Tab Structure

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Tab 1    │ Tab 2    │ Tab 3    │ Tab 4    │ Tab 5    │
│ 題目資訊  │ 提交設定  │ 測資管理  │ 判題設定  │ 評分規則  │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

**Core distinction between Tab 4 and Tab 5**:

- Tab 4 (Judge) = "How to determine right/wrong" (execution layer)
- Tab 5 (Scoring) = "How to calculate the final score" (scoring layer)

|                   | Tab 4: Judge Settings              | Tab 5: Scoring Rules                          |
| ----------------- | ---------------------------------- | --------------------------------------------- |
| Question answered | Is this testcase AC or WA?         | What is the final score?                      |
| Input             | Student output + expected answer   | Per-testcase verdicts + metadata              |
| Output            | pass/fail per testcase             | 0–100 final score                             |
| Example           | Checker verifies image correctness | Subtask 2 all-pass = 30 pts, late penalty -10 |

### Tab 1: Basic Info

Standard problem description. All users fill this.

| Field         | Description                                            |
| ------------- | ------------------------------------------------------ |
| Title         | Required                                               |
| Slug          | Auto-generated from title on create, manually editable |
| Difficulty    | easy / medium / hard                                   |
| Visibility    | public / private                                       |
| Tags          | Multiple, space-separated                              |
| Statement     | Markdown editor with preview                           |
| Input Format  | Markdown                                               |
| Output Format | Markdown                                               |
| Summary       | Short description for problem lists                    |

### Tab 2: Submission Settings

Controls what students submit and how it gets compiled.

| Field           | Description                                        |
| --------------- | -------------------------------------------------- |
| Submission Type | `full_source` / `function` / `zip_project` (radio) |
| Time Limit      | number input, ms                                   |
| Memory Limit    | number input, MB                                   |

**Conditional sections by submission type**:

- **full_source**: No additional settings
- **function**: Per-language template editor (driver code + insertion marker + template code)
- **zip_project**: Expected file structure description (text), compile command / Makefile path (optional), entry point setting

### Tab 3: Testcase Management

Full CRUD for testcases.

| Section          | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| Sample testcases | weight=0, visible to students on problem page                             |
| Subtask list     | Each subtask as a card: name, case count, weight                          |
| Per subtask      | Expand to view/edit/delete individual testcases (stdin / expected stdout) |
| Batch upload     | ZIP upload → auto-parse → preview → assign to subtasks                    |
| Add subtask      | Manual creation, set name and weight                                      |

### Tab 4: Judge Settings

Controls how to determine right/wrong. Everything related to execution, comparison, and analysis.

**Judge Type** (top of tab):

- Radio: Standard / Checker / Interactive
- Checker selected → expand Monaco editor for checker script + language selector + "Load default template" button
- Interactive selected → expand Monaco editor for interactor script + language selector + "Load default template" button

**Static Analysis** (toggle, off by default):

- Banned functions: tag-style input
- Banned imports: tag-style input
- Banned patterns: list with regex support
- Linter command: optional text input (e.g., `pylint --disable=C`)
- On lint failure: fail submission / warn only

**Artifact Collection** (toggle, off by default):

- Collection patterns: list (e.g., `*.bmp`, `output/*`)
- Max total size: number input, MB

**Network Access** (toggle, off by default):

- Firewall rules: list of `{ allow, ports, protocol }`
- Sidecar services: list of `{ image, port, env, readinessPath, memoryMb }`
- Log traffic: checkbox

**Custom Pipeline Stages** (toggle, off by default):

- Add custom scripts that run at specific points
- Per script: name, runAt (`before-compile` / `after-compile` / `after-check`), language, Monaco editor

### Tab 5: Scoring Rules

Controls how the final score is calculated after judging.

**Subtask Scoring** (always visible, synced from Tab 3):

- Per subtask: name, weight, scoring strategy dropdown
  - All-or-nothing: all testcases must pass to earn points
  - Proportional: pass 3/5 = 60% of subtask score
  - Minimum: worst testcase result determines subtask score
- Formula preview: `score = 0×S1 + 30×S2 + 70×S3 = 0~100`

**Score Adjustments** (toggle, off by default):

- Stackable rules, applied in order
- Rule types:
  - Late penalty (fixed per day/week, or proportional decay)
  - Execution time bonus
  - Memory usage penalty
- Each rule shows formula preview

**Advanced: Custom Scoring Script** (toggle, off by default):

- Warning: "Enabling this overrides all rules above"
- Language selector + timeout
- Monaco editor
- stdin: `{ rawScore, testcaseResults, submittedAt, runtimeMs, ... }`
- stdout: `{ finalScore, feedback }`
- Template loader: late penalty / performance scoring / blank

## Create vs Edit Flow

### Draft Workflow

1. **Create page** (`/problems/create`): Shows only Tab 1 (BasicInfoTab) with a "Create Draft" button
2. On submit → Problem saved to DB with `status: draft` → redirect to `/problems/[slug]/edit`
3. **Edit page** (`/problems/[slug]/edit`): Full 5-tab interface, all tabs functional
4. Problem remains `draft` until explicitly published (visible only to author/admin)

### Component Architecture

```
routes/
  problems/create/+page.svelte        ← Create page (Tab 1 + "Create Draft" button)
  problems/[slug]/edit/+page.svelte   ← Edit page (full 5 tabs)

components/problem/
  ProblemTabs.svelte                  ← Tab container (switching logic)
  tabs/
    BasicInfoTab.svelte               ← Tab 1: Basic Info
    SubmissionTab.svelte              ← Tab 2: Submission Settings
    TestcaseTab.svelte                ← Tab 3: Testcase Management
    JudgeTab.svelte                   ← Tab 4: Judge Settings
    ScoringTab.svelte                 ← Tab 5: Scoring Rules
  editors/
    MonacoScriptEditor.svelte         ← Shared editor for checker/interactor/scoring scripts
    CodeTemplateEditor.svelte         ← Existing function template editor
    MultiFileEditor.svelte            ← Multi-file editor for zip_project submissions
  testcase/
    TestcaseSetCard.svelte            ← Single subtask card (expand/collapse/edit/delete)
    TestcaseUploader.svelte           ← ZIP upload + parsing
    SubtaskConfig.svelte              ← Subtask grouping configuration
```

Each tab has its own superForm instance (independent validation, independent save). Switching tabs does not lose unsaved changes.

## Student Submission Page

Submission UI adapts based on `submissionType`:

- **full_source**: Monaco Editor + language selector (current behavior)
- **function**: Monaco Editor with pre-filled template, student writes in designated area (current behavior)
- **zip_project**: Multi-file editor with file tree sidebar + Monaco editor on the right. Supports ZIP upload to auto-populate files. Students can add/remove/edit files directly in the browser.

```
┌──────────┬──────────────────────┐
│ FILES    │                      │
│ > main.c │  (Monaco Editor)     │
│   utils.c│                      │
│   Makefile│                     │
│          │                      │
│ [+ Add]  │                      │
│ [Upload] │                      │
└──────────┴──────────────────────┘
```

## Usage Patterns

| User                        | Typical flow                                       |
| --------------------------- | -------------------------------------------------- |
| Teacher (simple problem)    | Tab 1 + Tab 3 only, everything else uses defaults  |
| Teacher (checker problem)   | Tab 1 + Tab 3 + Tab 4 (judge type = checker)       |
| Teacher (with late penalty) | Tab 1 + Tab 3 + Tab 5 (score adjustments)          |
| Advanced (code review)      | Tab 1 + Tab 2 + Tab 3 + Tab 4 (static analysis on) |
| Advanced (full pipeline)    | All 5 tabs                                         |
