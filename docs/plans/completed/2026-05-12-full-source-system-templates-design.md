# full_source 題目改用系統內建 starter templates

**Date:** 2026-05-12
**Status:** Design approved, parallel implementation in progress

## 問題

目前 `full_source` 題目的「可用語言」是由是否有 `ProblemWorkspaceFile` 條目決定的——只要老師為任何語言上傳了 starter，系統就把它當成「只接受該語言」。這跟 `full_source`（單檔提交、任何語言皆可）的語義矛盾，也讓比賽掛 `allowedLanguages: [python]` 時把不相干的 full_source 題硬塞 python workspace 需求。

## 目標

- `full_source` 題目永遠支援所有 `supportedLanguages` (8 個)
- 老師建立 / 編輯 `full_source` 題目時不能上傳 starter — 一律使用系統 template
- `multi_file` 行為維持不變
- 既有資料庫的 full_source 題目殘留 workspace files 一次性清掉

## 設計

### Template 內容 (`packages/core/src/language-templates.ts`)

```ts
export const LANGUAGE_TEMPLATES: Record<Language, string> = {
  c: `#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n    \n}\n`,
  java: `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n`,
  javascript: ``,
  python: ``,
  rust: `use std::io::{self, Read};\n\nfn main() {\n    \n}\n`,
  typescript: ``,
};
```

### Domain 層

1. **`packages/application/src/problem/queries.ts`**
   - 移除本地 `starterByLanguage` 常數，改 import `LANGUAGE_TEMPLATES`
   - `buildStarterByLanguage(type, workspaceFiles)`：`full_source` → 直接回傳 `LANGUAGE_TEMPLATES`；`multi_file` → 維持原 overlay 邏輯
   - 呼叫處 (`mapPersistedProblemDetail`) 傳入 `problem.type`

2. **`packages/application/src/submission/mutations.ts`**
   - 把 `if (problem.type !== "special_env")` 整塊改成 `if (problem.type === "multi_file")`
   - `full_source` 不再要求有 workspace entry

3. **`packages/application/src/problem/helpers.ts`**
   - `assertProblemHasWorkspaceForLanguages` 對 `full_source` 題目直接 return（永遠支援所有語言）

### 前端 UI

1. **`apps/web/src/lib/components/problem/ProblemSections.svelte`**
   - 加 `problemType: ProblemType` prop
   - `sections` 改為 `$derived`：`full_source` 時不包含 `workspace` tab

2. **`apps/web/src/lib/components/problem/LanguageSelector.svelte`**
   - 加 `problemType: ProblemType` prop
   - workspace 篩選只在 `problemType === "multi_file"` 時生效

3. **`apps/web/src/lib/components/problem/Editor.svelte`**
   - `isWorkspaceMode = $derived(problem.type === "multi_file")`
   - 傳 `problemType={problem.type}` 給 LanguageSelector

4. **`apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`**
   - 傳 `problemType={data.problem.type}` 給 ProblemSections
   - `workspaceInitial` 只在 multi_file 時建立

### Migration

`packages/db/prisma/migrations/20260512000000_drop_full_source_workspace_files/migration.sql`：

```sql
DELETE FROM "ProblemWorkspaceFile"
WHERE "problemId" IN (
  SELECT id FROM "Problem" WHERE type = 'full_source'
);
```

S3 contentKey orphan：本次只動 DB，孤兒物件之後寫 ops 腳本清。

### 測試

- `tests/unit/domain/problem-queries.test.ts`：full_source `starterByLanguage` 永遠回 8 個 template；既有殘留 workspace files 不影響輸出
- `tests/unit/domain/submission-mutations.test.ts`：full_source 8 種語言可送；multi_file 維持「缺 entry → 403」
- `tests/unit/domain/problem-helpers.test.ts`：`assertProblemHasWorkspaceForLanguages` 對 full_source 永遠 pass

### 變更檔案清單

**新增 (3):**

- `packages/core/src/language-templates.ts`
- `packages/db/prisma/migrations/20260512000000_drop_full_source_workspace_files/migration.sql`
- 三個 unit test 檔案

**修改 (8):**

- `packages/core/src/index.ts`
- `packages/application/src/problem/queries.ts`
- `packages/application/src/problem/helpers.ts`
- `packages/application/src/submission/mutations.ts`
- `apps/web/src/lib/components/problem/ProblemSections.svelte`
- `apps/web/src/lib/components/problem/LanguageSelector.svelte`
- `apps/web/src/lib/components/problem/Editor.svelte`
- `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`

## 平行實作策略

- **Track A**（foundation，inline）：`@nojv/core` template 常數 + index export — B/C 都會 import
- **Track B**（agent 1）：domain 層 3 檔 + 3 unit test 檔
- **Track C**（agent 2）：前端 UI 4 檔
- **Track D**（inline）：migration SQL

A、D inline 完成 → 並行 dispatch B、C → 整合驗證。
