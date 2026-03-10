# Problem Creation Redesign

## Overview

Redesign the problem creation page with UX-first approach, add partial scoring (subtasks), ZIP testcase upload, custom file naming, checker/interactive support, tags, and library filtering.

## Changes Summary

### 1. Prisma Schema Changes

- `Problem` model: Add `tags String[] @default([])` field
- No other schema changes needed (judgeType, checkerScript, interactorScript already exist)

### 2. Domain Schema Changes (`packages/domain/src/index.ts`)

- `problemCreateSchema`:
  - Remove required `summary` → make optional with default `""`
  - Remove required `slug` → auto-generate on backend from title if not provided
  - Add `tags: z.array(z.string()).default([])`
  - Add `judgeType: judgeTypeSchema.default("standard")`
  - Add `checkerScript: z.string().max(200_000).optional()`
  - Add `interactorScript: z.string().max(200_000).optional()`
  - Keep `inputFormat`, `outputFormat` (already optional)
- `problemTestcaseSetCreateSchema`: weight already supports partial scoring (points per subtask)

### 3. Data Access Changes

- `shared.ts` `CreateProblemDefinitionInput`: Add `tags`, `judgeType`, `checkerScript`, `interactorScript`
- `shared.ts` `createProblemDefinition`: Pass new fields to Problem.create
- `problems.ts` `createProblemRecord`: Pass new fields, auto-generate slug if missing

### 4. API Route Changes

- `POST /api/problems`: Already uses `problemCreateSchema.parse`, will work after schema update

### 5. Problem Creation UI (`ProblemCreationPanel`)

Completely rewrite with:

- **Remove**: slug field (auto-generate), summary field, subtitle heading, role badge
- **Change**: visibility default to "private"
- **Add**: Tag input (space to add tag, backspace to remove, pill display)
- **Add**: Judge type selector (standard / checker / interactive)
- **Add**: Checker script editor (Python, shown when judgeType=checker)
- **Add**: Interactor script editor (Python, shown when judgeType=interactive)
- **Add**: Subtask groups with points (TestcaseSet = subtask, weight = points)
  - Each subtask: name, points, list of testcases
  - All testcases in a subtask must pass to earn points
- **Add**: ZIP testcase upload per subtask
  - Upload button per subtask group
  - Parse ZIP client-side, extract files by naming pattern
- **Add**: Custom input/output file name pattern (e.g., `{n}.in` / `{n}.out`)

### 6. Problem Library Filtering (`ProblemsTabs`)

- Add search input (filter by title/slug)
- Add difficulty filter (all/easy/medium/hard)
- Add tag filter (show available tags, click to filter)

### 7. Seed Data

- Add interactive problem example with `interactorScript`
- Existing checker (`float-compare`) already has `checkerScript`

### 8. i18n Messages

- Add new keys for tags, subtasks, judge type, file pattern, ZIP upload, filters
