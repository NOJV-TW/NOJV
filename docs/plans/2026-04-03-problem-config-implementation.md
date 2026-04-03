# Problem Configuration Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate 8 scattered judge fields into a unified `judgeConfig`, redesign the problem creation/editing UI into a 5-tab interface with draft workflow, and add `zip_project` submission type.

**Architecture:** Schema-first approach — update core schemas and DB first, then domain/worker layers, then frontend. The frontend is split into shared tab components used by both create (Tab 1 only) and edit (all 5 tabs) pages.

**Tech Stack:** Zod 4, Prisma 7, SvelteKit, superforms, Monaco Editor, Tailwind CSS 4, Bits UI

**Design Doc:** `docs/plans/2026-04-03-problem-config-redesign.md`

---

## Phase 1: Schema & Data Layer

### Task 1: Create `judgeConfigSchema`

**Files:**

- Create: `packages/core/src/schemas/judge-config.ts`
- Modify: `packages/core/src/index.ts` (add export)

**Step 1: Create the schema file**

```typescript
// packages/core/src/schemas/judge-config.ts
import { z } from "zod";
import { judgeTypeSchema } from "../types";
import {
  staticAnalysisConfigSchema,
  scoringConfigSchema,
  artifactConfigSchema,
  networkAccessConfigSchema,
  pipelineStageSchema,
  customScriptConfigSchema
} from "../pipeline";

export const judgeConfigSchema = z.object({
  type: judgeTypeSchema.default("standard"),
  checkerScript: z.string().max(200_000).optional(),
  interactorScript: z.string().max(200_000).optional(),

  scoring: scoringConfigSchema.optional(),

  pipeline: z
    .object({
      stages: z.array(pipelineStageSchema).min(1).max(20)
    })
    .optional(),

  staticAnalysis: staticAnalysisConfigSchema.optional(),
  artifacts: artifactConfigSchema.optional(),
  networkAccess: networkAccessConfigSchema.optional(),
  customScripts: z
    .array(
      customScriptConfigSchema.extend({
        name: z.string().min(1).max(100)
      })
    )
    .max(10)
    .optional()
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
```

**Step 2: Export from core index**

Add `export * from "./schemas/judge-config";` to `packages/core/src/index.ts`.

**Step 3: Verify build**

Run: `pnpm --filter @nojv/core build`
Expected: SUCCESS

**Step 4: Commit**

```
feat(core): add unified judgeConfigSchema
```

---

### Task 2: Update Prisma Schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

**Step 1: Add `zip_project` to SubmissionType enum**

```prisma
enum SubmissionType {
  function
  full_source
  zip_project
}
```

**Step 2: Add `ProblemStatus` enum**

```prisma
enum ProblemStatus {
  draft
  published
}
```

**Step 3: Update Problem model**

Remove these fields:

- `judgeType`
- `checkerScript`
- `interactorScript`
- `pipelineConfig`
- `scoringScript`
- `scoringLanguage`
- `artifactPatterns`
- `networkAccessConfig`

Add these fields:

- `judgeConfig Json?`
- `status ProblemStatus @default(published)`

The Problem model should become:

```prisma
model Problem {
  id                  String                  @id @default(cuid())
  slug                String                  @unique
  defaultTitle        String
  summary             String                  @db.Text
  difficulty          String
  visibility          ProblemVisibility       @default(public)
  status              ProblemStatus           @default(published)
  tags                String[]                @default([])
  authorId            String?
  timeLimitMs         Int
  memoryLimitMb       Int
  submissionType      SubmissionType          @default(full_source)
  judgeConfig         Json?
  createdAt           DateTime                @default(now())
  updatedAt           DateTime                @updatedAt
  // ... relations unchanged
}
```

**Step 4: Regenerate Prisma client and push**

Run: `pnpm db:generate && pnpm db:push`
Expected: SUCCESS

**Step 5: Commit**

```
feat(db): consolidate judge fields into judgeConfig, add problem status and zip_project
```

---

### Task 3: Update Core Problem Schemas

**Files:**

- Modify: `packages/core/src/schemas/problem.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schemas/submission.ts`

**Step 1: Update types.ts**

Add `zip_project` to `submissionTypes`:

```typescript
export const submissionTypes = ["function", "full_source", "zip_project"] as const;
```

Add problem statuses:

```typescript
export const problemStatuses = ["draft", "published"] as const;
export const problemStatusSchema = z.enum(problemStatuses);
export type ProblemStatus = z.infer<typeof problemStatusSchema>;
```

**Step 2: Update problemCreateSchema**

Remove the 8 old fields. Add `judgeConfig` and `status`:

```typescript
export const problemCreateSchema = z.object({
  difficulty: problemDifficultySchema,
  inputFormat: z.string().trim().max(4_000).default(""),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  outputFormat: z.string().trim().max(4_000).default(""),
  slug: slugSchema,
  statement: z.string().trim().min(16).max(12_000),
  submissionType: submissionTypeSchema.default("full_source"),
  summary: z.string().trim().max(2_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  templates: z.array(problemTemplateSchema).max(10).default([]),
  timeLimitMs: z.coerce.number().int().min(100).max(30_000).default(1_000),
  title: z.string().trim().min(3).max(120),
  visibility: problemVisibilitySchema,
  judgeConfig: judgeConfigSchema.optional(),
  status: problemStatusSchema.default("draft")
});
```

**Step 3: Update submissionDraftSchema**

Add `sourceFiles` field for zip_project (check if already present — it is in the current schema as optional). Verify `entryFile` field exists. No changes needed if already present.

**Step 4: Verify build**

Run: `pnpm --filter @nojv/core build`
Expected: SUCCESS

**Step 5: Commit**

```
feat(core): update problem schemas for judgeConfig and zip_project
```

---

### Task 4: Update Seed File

**Files:**

- Modify: `packages/db/prisma/seeds/problems.ts`

**Step 1: Update `SeedProblemDef` type**

Replace `judgeType`, `checkerScript`, `interactorScript` with `judgeConfig`:

```typescript
interface SeedProblemDef {
  authorId?: string;
  defaultTitle: string;
  difficulty: "easy" | "medium" | "hard";
  id: string;
  memoryLimitMb: number;
  slug: string;
  summary: string;
  timeLimitMs: number;
  visibility: "public" | "private";
  statements: SeedStatements;
  testcases: SeedTestcaseSets;
  submissionType?: "function" | "full_source" | "zip_project";
  judgeConfig?: Record<string, unknown>;
  status?: "draft" | "published";
}
```

**Step 2: Update problem definitions**

For any problem that currently uses `judgeType: "checker"` or `interactorScript`, convert to `judgeConfig` format:

```typescript
// Before:
{ judgeType: "checker", checkerScript: "..." }

// After:
{ judgeConfig: { type: "checker", checkerScript: "..." } }
```

**Step 3: Update the upsert call**

Change the `prisma.problem.upsert()` call to use `judgeConfig` instead of the old fields.

**Step 4: Update validation function**

Update `validateProblemDefinitions()` to validate `judgeConfig` instead of checking `checkerScript`/`interactorScript` separately.

**Step 5: Run seed**

Run: `pnpm db:seed`
Expected: SUCCESS with all problems seeded

**Step 6: Commit**

```
feat(db): update seed to use judgeConfig
```

---

### Task 5: Update Domain Layer

**Files:**

- Modify: `packages/domain/src/problem/mutations.ts`
- Modify: `packages/domain/src/submission/judge-context.ts`
- Modify: `packages/domain/src/problem/queries.ts` (if it references old fields)

**Step 1: Update `CreateProblemDefinitionInput`**

Replace the 8 old fields with `judgeConfig`:

```typescript
export interface CreateProblemDefinitionInput {
  authorId?: string | undefined;
  difficulty: ProblemDifficulty;
  inputFormat?: string | undefined;
  memoryLimitMb?: number | undefined;
  outputFormat?: string | undefined;
  statement?: string | undefined;
  submissionType?: SubmissionType | undefined;
  summary: string;
  tags?: string[] | undefined;
  timeLimitMs?: number | undefined;
  title: string;
  visibility?: ProblemVisibility | undefined;
  judgeConfig?: unknown;
  status?: string | undefined;
}
```

**Step 2: Update `createProblemDefinition()`**

Replace the old field assignments with:

```typescript
const problem = await problemRepo.withTx(tx).create({
  // ... other fields unchanged
  judgeConfig: input.judgeConfig ?? undefined,
  status: input.status ?? "published"
  // Remove: judgeType, checkerScript, interactorScript, pipelineConfig,
  //         scoringScript, scoringLanguage, artifactPatterns, networkAccessConfig
} as any);
```

**Step 3: Update `updateProblemRecord()`**

Replace the 8 old field checks with a single `judgeConfig` check:

```typescript
if (payload.judgeConfig !== undefined) updateData.judgeConfig = payload.judgeConfig;
if (payload.status !== undefined) updateData.status = payload.status;
```

**Step 4: Update `createProblemRecord()`**

Pass `judgeConfig` and `status` instead of old fields.

**Step 5: Update `getJudgeContext()`**

Read from `judgeConfig` JSON instead of individual fields:

```typescript
const judgeConfig = (problem.judgeConfig as JudgeConfig | null) ?? { type: "standard" };

return {
  checkerScript: judgeConfig.checkerScript ?? null,
  interactorScript: judgeConfig.interactorScript ?? null,
  judgeType: judgeConfig.type,
  // ... other fields from judgeConfig
  networkAccessConfig: judgeConfig.networkAccess ?? null,
  pipelineConfig: judgeConfig.pipeline ?? null,
  scoringLanguage: judgeConfig.scoring?.language ?? null,
  scoringScript: judgeConfig.scoring?.script ?? null,
  artifactPatterns: judgeConfig.artifacts?.patterns ?? []
  // ... rest unchanged
};
```

**Step 6: Verify build**

Run: `pnpm --filter @nojv/domain build`
Expected: SUCCESS

**Step 7: Commit**

```
feat(domain): migrate problem mutations and judge-context to judgeConfig
```

---

### Task 6: Update Worker / Temporal Activities

**Files:**

- Modify: `packages/temporal/src/activities/judge.ts`

**Step 1: Verify `executeSandbox()` still works**

The `executeSandbox()` function receives `SubmissionJudgeContext` from `getJudgeContext()`. Since Task 5 ensures `getJudgeContext()` returns the same interface shape (reading from `judgeConfig` instead of individual fields), `executeSandbox()` should work without changes.

**Step 2: Check SandboxRequest building**

Verify that lines 229-271 in `judge.ts` (which build `SandboxRequest` from `judgeContext`) still compile. The `SubmissionJudgeContext` interface hasn't changed — only how it's populated.

**Step 3: Build and verify**

Run: `pnpm --filter @nojv/temporal build`
Expected: SUCCESS

**Step 4: Commit (if any changes needed)**

```
fix(temporal): adapt judge activity to updated judge-context interface
```

---

## Phase 2: Frontend Infrastructure

### Task 7: Create Tab Container and Route Updates

**Files:**

- Create: `apps/web/src/lib/components/problem/ProblemTabs.svelte`
- Modify: `apps/web/src/routes/(app)/problems/create/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/problems/create/+page.svelte`
- Modify: `apps/web/src/routes/(app)/problems/[slug]/edit/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/problems/[slug]/edit/+page.svelte`
- Modify: `apps/web/src/lib/types.ts` (update ProblemDetail)

**Step 1: Update ProblemDetail type**

Replace old fields with `judgeConfig` and add `status`:

```typescript
export interface ProblemDetail extends ProblemOverview {
  authorUsername: string;
  inputFormat: string;
  judgeConfig?: JudgeConfig;
  memoryLimitMb: number;
  outputFormat: string;
  samples: { explanation: string; input: string; output: string }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  status: "draft" | "published";
  submissionType: SubmissionType;
  summary: string;
  tags: string[];
  templates: Partial<Record<Language, TemplateInfo>>;
  timeLimitMs: number;
  visibility: ProblemVisibility;
}
```

**Step 2: Create ProblemTabs.svelte**

Tab container with 5 tabs. Uses Bits UI tabs or simple custom tabs matching existing design system:

```svelte
<script lang="ts">
  import type { ProblemDetail } from "$lib/types";

  interface Props {
    problem: ProblemDetail;
    activeTab?: string;
  }

  let { problem, activeTab = "basic" }: Props = $props();

  const tabs = [
    { id: "basic", label: "題目資訊" },
    { id: "submission", label: "提交設定" },
    { id: "testcase", label: "測資管理" },
    { id: "judge", label: "判題設定" },
    { id: "scoring", label: "評分規則" },
  ];
</script>

<div>
  <nav class="flex gap-1 border-b border-border mb-6">
    {#each tabs as tab (tab.id)}
      <button
        class="px-4 py-2 text-sm font-medium transition-colors
          {activeTab === tab.id
            ? 'border-b-2 border-primary text-primary'
            : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  <div>
    {#if activeTab === "basic"}
      <slot name="basic" />
    {:else if activeTab === "submission"}
      <slot name="submission" />
    {:else if activeTab === "testcase"}
      <slot name="testcase" />
    {:else if activeTab === "judge"}
      <slot name="judge" />
    {:else if activeTab === "scoring"}
      <slot name="scoring" />
    {/if}
  </div>
</div>
```

**Step 3: Update create page for draft workflow**

`/problems/create/+page.svelte` — show only BasicInfoTab with "Create Draft" button.
`/problems/create/+page.server.ts` — set `status: "draft"` on create.

**Step 4: Update edit page for 5-tab interface**

`/problems/[slug]/edit/+page.svelte` — render ProblemTabs with all 5 tab slots.
`/problems/[slug]/edit/+page.server.ts` — load `judgeConfig` from problem, add actions for each tab.

**Step 5: Update problem queries**

Ensure `getProblemPageData()` returns `judgeConfig` and `status` instead of old fields.

**Step 6: Verify page loads**

Run: `pnpm dev`
Navigate to `/problems/create` and `/problems/[slug]/edit`
Expected: Pages render without errors

**Step 7: Commit**

```
feat(web): add ProblemTabs container and draft workflow routes
```

---

## Phase 3: Frontend — Tab Components

### Task 8: Tab 1 — BasicInfoTab

**Files:**

- Create: `apps/web/src/lib/components/problem/tabs/BasicInfoTab.svelte`

**Step 1: Extract from CreationPanel.svelte**

Move these fields from `CreationPanel.svelte` into `BasicInfoTab.svelte`:

- Title (line 237-246)
- Tags (line 248-282)
- Difficulty + Visibility (line 285-309)
- Statement (line 431-440)
- Input/Output Format (line 442-460)
- Summary (currently not in form, add it)
- Slug (auto-generated, editable in create mode)

This tab gets its own superForm instance with a subset schema:

```typescript
const basicInfoSchema = z.object({
  title: z.string().trim().min(3).max(120),
  slug: slugSchema.optional(), // only on create
  difficulty: problemDifficultySchema,
  visibility: problemVisibilitySchema,
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  statement: z.string().trim().min(16).max(12_000),
  inputFormat: z.string().trim().max(4_000).default(""),
  outputFormat: z.string().trim().max(4_000).default(""),
  summary: z.string().trim().max(2_000).default(""),
  status: problemStatusSchema.optional()
});
```

Each tab has its own save button. On save, POST to `?/updateBasicInfo` action.

**Step 2: Verify**

Run dev, edit a problem, Tab 1 should render and save correctly.

**Step 3: Commit**

```
feat(web): add BasicInfoTab component
```

---

### Task 9: Tab 2 — SubmissionTab

**Files:**

- Create: `apps/web/src/lib/components/problem/tabs/SubmissionTab.svelte`
- Create: `apps/web/src/lib/components/problem/editors/MultiFileEditor.svelte`
- Modify: `apps/web/src/lib/components/problem/CodeTemplateEditor.svelte` (if needed)

**Step 1: Create SubmissionTab.svelte**

Fields:

- Submission type radio: `full_source` / `function` / `zip_project`
- Time limit (ms)
- Memory limit (MB)
- Conditional sections:
  - `function` → CodeTemplateEditor
  - `zip_project` → file structure description, compile command, entry point

**Step 2: Create MultiFileEditor.svelte**

Left sidebar with file tree + right Monaco editor. This component is used in two places:

1. **Tab 2** (teacher side): For configuring zip_project expected structure (optional)
2. **Student submission page**: For editing/uploading zip_project files

Features:

- File tree with add/rename/delete
- Monaco editor for selected file
- ZIP upload button → auto-extract files into tree
- Language detection from file extension

```svelte
<script lang="ts">
  interface FileEntry {
    path: string;
    content: string;
  }

  interface Props {
    files: FileEntry[];
    onchange?: (files: FileEntry[]) => void;
    readonly?: boolean;
  }

  let { files = $bindable(), onchange, readonly = false }: Props = $props();
  let selectedPath = $state(files[0]?.path ?? "");
</script>
```

**Step 3: Verify**

Run dev, edit a problem, Tab 2 should render. Test switching between submission types.

**Step 4: Commit**

```
feat(web): add SubmissionTab and MultiFileEditor components
```

---

### Task 10: Tab 3 — TestcaseTab

**Files:**

- Create: `apps/web/src/lib/components/problem/tabs/TestcaseTab.svelte`
- Create: `apps/web/src/lib/components/problem/testcase/TestcaseSetCard.svelte`
- Modify: `apps/web/src/lib/components/problem/testcase/TestcaseUploader.svelte` (rename from TestcaseSection.svelte or create new)
- Modify: `apps/web/src/routes/(app)/problems/[slug]/edit/+page.server.ts` (add CRUD actions)

**Step 1: Add server-side CRUD actions**

Add to edit page.server.ts:

- `updateTestcaseSet` — update name/weight/isHidden
- `deleteTestcaseSet` — delete a testcase set
- `updateTestcase` — update individual testcase stdin/expectedStdout
- `deleteTestcase` — delete individual testcase

These call new domain functions (add to `packages/domain/src/problem/mutations.ts`):

- `updateTestcaseSetRecord(actor, problemSlug, setId, payload)`
- `deleteTestcaseSetRecord(actor, problemSlug, setId)`
- `updateTestcaseRecord(actor, problemSlug, testcaseId, payload)`
- `deleteTestcaseRecord(actor, problemSlug, testcaseId)`

Add corresponding repository methods in `packages/db/src/repositories/problem.ts`:

- `testcaseSetRepo.update(id, data)`
- `testcaseSetRepo.delete(id)`
- `testcaseRepo.update(id, data)`
- `testcaseRepo.delete(id)`

**Step 2: Create TestcaseSetCard.svelte**

A card component for one testcase set (subtask):

- Header: name, case count, weight, hidden badge
- Expand/collapse to show individual testcases
- Edit button → inline edit name/weight
- Delete button → confirm dialog
- Per testcase: stdin/expectedStdout (editable), delete button

**Step 3: Create TestcaseTab.svelte**

Layout:

- Sample testcases section (weight=0 sets)
- Subtask list (weight>0 sets), each rendered as TestcaseSetCard
- "Add Subtask" button → new TestcaseSetCard
- ZIP batch upload section (reuse/adapt existing TestcaseSection logic)

**Step 4: Load existing testcases**

The edit page server load already fetches `problem` with testcase sets via `getProblemPageData()`. Verify this includes full testcase data (stdin, expectedStdout) — currently it includes up to 10 per set. May need to add pagination or lazy loading for large sets.

**Step 5: Verify**

Run dev, edit a problem with existing testcases. Should display all sets. Test add/edit/delete.

**Step 6: Commit**

```
feat(web): add TestcaseTab with full CRUD for testcase sets and testcases
```

---

### Task 11: Tab 4 — JudgeTab

**Files:**

- Create: `apps/web/src/lib/components/problem/tabs/JudgeTab.svelte`
- Create: `apps/web/src/lib/components/problem/editors/MonacoScriptEditor.svelte`

**Step 1: Create MonacoScriptEditor.svelte**

Reusable Monaco editor wrapper for scripts (checker, interactor, scoring, custom). Props:

```typescript
interface Props {
  value: string;
  onchange: (value: string) => void;
  language?: string; // "python" | "cpp" | "c" | "go" | "rust"
  placeholder?: string;
  height?: string; // CSS height, default "300px"
  defaultTemplate?: string; // "Load template" button content
}
```

Uses the same Monaco lazy-loading pattern as `Editor.svelte` (dynamic import on mount).

**Step 2: Create JudgeTab.svelte**

Sections (each with toggle except judge type):

1. **Judge Type** — radio buttons, conditional script editors
2. **Static Analysis** — toggle, banned functions/imports/patterns, linter command
3. **Artifact Collection** — toggle, patterns list, max size
4. **Network Access** — toggle, firewall rules, sidecar services
5. **Custom Pipeline Stages** — toggle, list of custom scripts

Each toggle section stores its config in the `judgeConfig` object. On save, the entire `judgeConfig` JSON is sent.

**Step 3: Add server action**

Add `updateJudgeConfig` action to edit page.server.ts:

```typescript
updateJudgeConfig: async (event) => {
  const actor = requireAuth(event);
  const slug = event.params.slug;
  const form = await superValidate(event, zod4(judgeConfigSchema));
  if (!form.valid) return fail(400, { form });
  await updateProblemRecord(actor, slug, { judgeConfig: form.data });
  return { success: true };
};
```

**Step 4: Verify**

Run dev, edit a problem, Tab 4. Test:

- Switch judge type to checker → script editor appears
- Toggle static analysis → banned function input appears
- Toggle network access → firewall rules appear

**Step 5: Commit**

```
feat(web): add JudgeTab with full judge configuration UI
```

---

### Task 12: Tab 5 — ScoringTab

**Files:**

- Create: `apps/web/src/lib/components/problem/tabs/ScoringTab.svelte`

**Step 1: Create ScoringTab.svelte**

Three sections:

1. **Subtask Scoring** (always visible):
   - Read subtask list from problem data (synced with Tab 3)
   - Per subtask: name (readonly), weight (readonly, edit in Tab 3), scoring strategy dropdown
   - Strategies: `all_or_nothing` | `proportional` | `minimum`
   - Formula preview

2. **Score Adjustments** (toggle):
   - Add rule button
   - Rule types: late_penalty_fixed, late_penalty_decay, time_bonus, memory_penalty
   - Each rule: type dropdown + config fields + formula preview
   - Rules applied in order (drag to reorder)

3. **Custom Scoring Script** (toggle):
   - Warning: overrides above rules
   - MonacoScriptEditor for script
   - Language selector + timeout
   - Template loader dropdown

Scoring config is stored in `judgeConfig.scoring`. Subtask strategies and score adjustments are stored as a structured object within scoring config.

Update `scoringConfigSchema` in `packages/core/src/pipeline.ts` to support both script mode and rules mode:

```typescript
export const scoringRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("late_penalty_fixed"),
    perUnit: z.enum(["day", "week"]),
    amount: z.number().min(0).max(100),
    maxDeduction: z.number().min(0).max(100)
  }),
  z.object({
    type: z.literal("late_penalty_decay"),
    halfLifeHours: z.number().min(1).max(8760)
  }),
  z.object({
    type: z.literal("time_bonus"),
    maxBonusPercent: z.number().min(0).max(100),
    baselineMs: z.number().min(0)
  }),
  z.object({
    type: z.literal("memory_penalty"),
    thresholdMb: z.number().min(0),
    maxDeduction: z.number().min(0).max(100)
  })
]);

export const subtaskScoringStrategy = z.enum(["all_or_nothing", "proportional", "minimum"]);

export const scoringConfigSchema = z.object({
  // Script mode (overrides rules)
  script: z.string().min(1).max(200_000).optional(),
  language: languageSchema.or(z.literal("python3")).optional(),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),

  // Rules mode
  subtaskStrategies: z.record(z.string(), subtaskScoringStrategy).optional(),
  adjustmentRules: z.array(scoringRuleSchema).max(10).optional()
});
```

**Step 2: Add server action**

Add `updateScoring` action similar to `updateJudgeConfig`.

**Step 3: Verify**

Run dev, edit a problem with subtasks, Tab 5. Test:

- Subtask strategies show correctly
- Add a late penalty rule
- Toggle custom script mode

**Step 4: Commit**

```
feat(web): add ScoringTab with rules GUI and custom script support
```

---

## Phase 4: Student Submission Page

### Task 13: Update Student Submission UI for zip_project

**Files:**

- Modify: `apps/web/src/lib/components/problem/Editor.svelte`
- Modify: `apps/web/src/lib/components/problem/Workspace.svelte`

**Step 1: Update Editor.svelte**

Add conditional rendering based on `submissionType`:

- `full_source` / `function`: current Monaco editor (unchanged)
- `zip_project`: render `MultiFileEditor` (created in Task 9)

For zip_project submissions:

- `sourceCode` becomes empty string or entry file content
- `sourceFiles` is populated from MultiFileEditor's file list
- Language detection from entry file extension

**Step 2: Update submission payload**

In `executeSubmission()`, when submissionType is `zip_project`:

```typescript
const body = {
  ...commonFields,
  sourceCode: "", // not used for zip
  sourceFiles: files.map((f) => ({ path: f.path, content: f.content })),
  entryFile: entryFilePath,
  submissionType: "zip_project"
};
```

**Step 3: Update Workspace.svelte**

Pass `submissionType` to Editor component so it can switch modes.

**Step 4: Verify**

Create a problem with `zip_project` type. Open the problem page as a student. Should see multi-file editor instead of single Monaco editor.

**Step 5: Commit**

```
feat(web): support zip_project submission type in student editor
```

---

## Phase 5: Cleanup

### Task 14: Remove Old CreationPanel and Clean Up

**Files:**

- Delete: `apps/web/src/lib/components/problem/CreationPanel.svelte` (replaced by tab components)
- Modify: any remaining imports of `CreationPanel`
- Modify: i18n message files if new keys are needed

**Step 1: Search for CreationPanel imports**

Find all files importing `CreationPanel.svelte` and update them.

**Step 2: Remove the old component**

Delete `CreationPanel.svelte`.

**Step 3: Add i18n keys**

Add new translation keys to `apps/web/messages/en.json` and `apps/web/messages/zh-TW.json` for:

- Tab labels
- New field labels (status, scoring strategies, adjustment rules, etc.)
- Toggle descriptions

**Step 4: Verify full flow**

Test the complete flow:

1. Create draft problem → fills Tab 1 → save
2. Edit → Tab 2 set submission type
3. Tab 3 add testcases via ZIP
4. Tab 4 set checker judge type
5. Tab 5 set subtask scoring strategies
6. Publish problem (change status to published)
7. Open as student → submit solution

Run: `pnpm lint && pnpm build`
Expected: SUCCESS

**Step 5: Commit**

```
refactor(web): remove CreationPanel, finalize problem config redesign
```

---

## Task Dependency Graph

```
Task 1 (judgeConfigSchema)
  └→ Task 2 (Prisma schema)
       └→ Task 3 (core schemas)
            ├→ Task 4 (seed)
            └→ Task 5 (domain layer)
                 └→ Task 6 (worker)
                      └→ Task 7 (frontend infra)
                           ├→ Task 8 (Tab 1)
                           ├→ Task 9 (Tab 2 + MultiFileEditor)
                           ├→ Task 10 (Tab 3)
                           ├→ Task 11 (Tab 4)
                           └→ Task 12 (Tab 5)
                                └→ Task 13 (student submission)
                                     └→ Task 14 (cleanup)
```

Tasks 8-12 can be parallelized (they are independent tab components).
Task 13 depends on Task 9 (MultiFileEditor).

## Notes

- **No migration**: Direct schema update. Existing data will lose judge config — reseed after schema push.
- **Draft status**: All existing problems default to `published`. New problems start as `draft`.
- **Backward compatibility**: `getJudgeContext()` handles `judgeConfig: null` by defaulting to `{ type: "standard" }`.
- **i18n**: All new UI text needs both `en` and `zh-TW` translations.
