# Judge System Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support function-mode submissions (LeetCode-style) and full-source submissions, with standard, checker, and interactive judge types.

**Architecture:** Extend existing Prisma schema with new enums/models, refactor `submission-runner.ts` to dispatch by judge type, assemble source from templates for function mode. Checker and interactor scripts run as separate processes in the same sandbox container.

**Tech Stack:** Prisma (PostgreSQL), Zod (validation), BullMQ (queue), Docker sandbox (execution)

---

### Task 1: Add Prisma schema enums and modify Problem model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

**Step 1: Add new enums**

Add after the `SubmissionStatus` enum (line 38):

```prisma
enum JudgeType {
  standard
  checker
  interactive
}

enum SubmissionType {
  function
  full_source
}
```

**Step 2: Add fields to Problem model**

Add after `memoryLimitMb` (line 175):

```prisma
  judgeType         JudgeType         @default(standard)
  submissionType    SubmissionType    @default(full_source)
  checkerScript     String?           @db.Text
  interactorScript  String?           @db.Text
```

**Step 3: Make Testcase.expectedStdout optional, add inputFiles**

Change line 220 from:

```prisma
  expectedStdout String      @db.Text
```

to:

```prisma
  expectedStdout String?     @db.Text
  inputFiles     Json?
```

**Step 4: Add ProblemTemplate model**

Add after the `Testcase` model (after line 226):

```prisma
model ProblemTemplate {
  id              String            @id @default(cuid())
  problemId       String
  language        SupportedLanguage
  driverCode      String            @db.Text
  templateCode    String            @db.Text
  insertionMarker String            @default("// __USER_CODE__")
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  problem         Problem           @relation(fields: [problemId], references: [id], onDelete: Cascade)

  @@unique([problemId, language])
}
```

Add to Problem model relations (after `testcaseSets` line 179):

```prisma
  templates         ProblemTemplate[]
```

**Step 5: Run migration**

Run: `cd packages/db && pnpm prisma migrate dev --name add-judge-types-and-templates`

Expected: Migration created and applied successfully. Prisma client regenerated.

**Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add judge type, submission type, and problem template schema"
```

---

### Task 2: Add domain Zod schemas for new types

**Files:**

- Modify: `packages/domain/src/index.ts`

**Step 1: Add new const arrays and schemas**

Add after `submissionModes` (line 21):

```typescript
export const judgeTypes = ["standard", "checker", "interactive"] as const;
export const submissionTypes = ["function", "full_source"] as const;
```

Add schemas after `submissionModeSchema` (line 77):

```typescript
export const judgeTypeSchema = z.enum(judgeTypes);
export const submissionTypeSchema = z.enum(submissionTypes);
```

**Step 2: Update `problemJudgeTestcaseSchema`**

Change `expectedStdout` from required to optional, add `inputFiles`:

```typescript
export const problemJudgeTestcaseSchema = z.object({
  expectedStdout: z.string().max(200_000).optional(),
  id: z.string().trim().min(1),
  inputFiles: z.record(z.string(), z.string()).optional(),
  isHidden: z.boolean(),
  stdin: z.string().max(200_000),
  weight: z.coerce.number().int().min(1).max(100)
});
```

**Step 3: Add `problemTemplateSchema`**

```typescript
export const problemTemplateSchema = z.object({
  driverCode: z.string().min(1).max(200_000),
  insertionMarker: z.string().min(1).max(200).default("// __USER_CODE__"),
  language: languageSchema,
  templateCode: z.string().min(1).max(100_000)
});
```

**Step 4: Export new types**

```typescript
export type JudgeType = z.infer<typeof judgeTypeSchema>;
export type SubmissionType = z.infer<typeof submissionTypeSchema>;
export type ProblemTemplate = z.infer<typeof problemTemplateSchema>;
```

**Step 5: Verify types compile**

Run: `cd packages/domain && pnpm tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add packages/domain/src/index.ts
git commit -m "feat: add judge type and problem template domain schemas"
```

---

### Task 3: Update judge operations to include new context

**Files:**

- Modify: `packages/db/src/judge-operations.ts`

**Step 1: Update `SubmissionJudgeContext` interface**

Replace the existing interface (lines 286-291):

```typescript
export interface SubmissionJudgeContext {
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: "standard" | "checker" | "interactive";
  memoryLimitMb: number;
  problemSlug: string;
  submissionType: "function" | "full_source";
  templates: Array<{
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }>;
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
}
```

**Step 2: Update `getSubmissionJudgeContext` query**

Add `templates` to the `include` block inside `problem`, and map new fields:

```typescript
export async function getSubmissionJudgeContext(
  submissionId: string
): Promise<SubmissionJudgeContext | null> {
  const submission = await prisma.submission.findUnique({
    include: {
      problem: {
        include: {
          templates: true,
          testcaseSets: {
            include: {
              testcases: {
                orderBy: {
                  ordinal: "asc"
                }
              }
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      }
    },
    where: {
      id: submissionId
    }
  });

  if (!submission) {
    return null;
  }

  return {
    checkerScript: submission.problem.checkerScript,
    interactorScript: submission.problem.interactorScript,
    judgeType: submission.problem.judgeType,
    memoryLimitMb: submission.problem.memoryLimitMb,
    problemSlug: submission.problem.slug,
    submissionType: submission.problem.submissionType,
    templates: submission.problem.templates.map((t) => ({
      driverCode: t.driverCode,
      insertionMarker: t.insertionMarker,
      language: t.language,
      templateCode: t.templateCode
    })),
    testcases: submission.problem.testcaseSets.flatMap((testcaseSet) =>
      testcaseSet.testcases.map((testcase) => ({
        expectedStdout: testcase.expectedStdout ?? undefined,
        id: testcase.id,
        inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
        isHidden: testcaseSet.isHidden,
        stdin: testcase.stdin,
        weight: testcaseSet.weight
      }))
    ),
    timeLimitMs: submission.problem.timeLimitMs
  };
}
```

**Step 3: Verify types compile**

Run: `cd packages/db && pnpm tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add packages/db/src/judge-operations.ts
git commit -m "feat: include judge type and templates in submission judge context"
```

---

### Task 4: Refactor submission runner — source assembly and standard judge

**Files:**

- Modify: `apps/worker/src/services/submission-runner.ts`

**Step 1: Add source assembly function**

Add after the `getLanguageSpec` function:

```typescript
interface ProblemTemplateInfo {
  driverCode: string;
  insertionMarker: string;
  language: string;
  templateCode: string;
}

function assembleSourceCode(
  userCode: string,
  submissionType: "function" | "full_source",
  language: string,
  templates: ProblemTemplateInfo[]
): string {
  if (submissionType === "full_source") {
    return userCode;
  }

  const template = templates.find((t) => t.language === language);
  if (!template) {
    throw new Error(`No template found for language "${language}" in function-mode problem.`);
  }

  if (!template.driverCode.includes(template.insertionMarker)) {
    throw new Error(
      `Driver code does not contain insertion marker "${template.insertionMarker}".`
    );
  }

  return template.driverCode.replace(template.insertionMarker, userCode);
}
```

**Step 2: Update `JudgeSubmissionInput` interface**

```typescript
export interface JudgeSubmissionInput {
  draft: SubmissionDraft;
  judgeType?: "standard" | "checker" | "interactive";
  checkerScript?: string | null;
  interactorScript?: string | null;
  memoryLimitMb?: number;
  submissionType?: "function" | "full_source";
  templates?: ProblemTemplateInfo[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs?: number;
}
```

**Step 3: Update `judgeSubmissionAgainstTestcases` to assemble source**

At the start of the function, after validating language and testcases, add source assembly:

```typescript
const submissionType = payload.submissionType ?? "full_source";
const templates = payload.templates ?? [];
const judgeType = payload.judgeType ?? "standard";

let assembledSourceCode: string;
try {
  assembledSourceCode = assembleSourceCode(
    draft.sourceCode,
    submissionType,
    draft.language,
    templates
  );
} catch (error) {
  return submissionResultSchema.parse({
    accepted: false,
    feedback: error instanceof Error ? error.message : "Source assembly failed.",
    runtimeMs: 0,
    score: 0,
    verdict: "compile_error"
  });
}
```

Then pass `assembledSourceCode` instead of `draft.sourceCode` when creating the run solution input. Create a modified draft for the sandbox:

```typescript
const assembledDraft = { ...draft, sourceCode: assembledSourceCode };
```

Use `assembledDraft` in the `runSolution` call.

**Step 4: Extract standard judge logic to a function**

Extract the current testcase loop into `judgeStandard()` so that checker and interactive can be added as separate functions later. The testcase comparison block (`normalizeProgramOutput` comparison) stays in `judgeStandard`.

**Step 5: Verify existing tests still pass**

Run: `cd apps/worker && pnpm vitest run`
Expected: All 3 existing tests pass.

**Step 6: Commit**

```bash
git add apps/worker/src/services/submission-runner.ts
git commit -m "feat: add source assembly for function-mode and extract standard judge"
```

---

### Task 5: Add checker judge mode

**Files:**

- Modify: `apps/worker/src/services/submission-runner.ts`

**Step 1: Write failing test for checker mode**

Add to `apps/worker/tests/submission-runner.test.ts`:

```typescript
it("accepts via checker script when checker exits 0", async () => {
  const { judgeSubmissionAgainstTestcases } = await import("../src/services/submission-runner");

  // First call: user program runs, produces output
  // Second call: checker script runs, exits 0
  const runSolution = vi
    .fn()
    .mockResolvedValueOnce({
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "3.000001\n"
    })
    .mockResolvedValueOnce({
      durationMs: 5,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "100\n"
    });

  const result = await judgeSubmissionAgainstTestcases(
    {
      checkerScript: "import sys\nsys.exit(0)\n",
      draft: {
        language: "python",
        mode: "practice",
        problemSlug: "float-check",
        sourceCode: "print(3.000001)\n"
      },
      judgeType: "checker",
      testcases: [
        {
          expectedStdout: "3\n",
          id: "tc_01",
          isHidden: false,
          stdin: "1 2\n",
          weight: 1
        }
      ]
    },
    { runSolution }
  );

  expect(result.verdict).toBe("accepted");
  expect(runSolution).toHaveBeenCalledTimes(2);
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm vitest run`
Expected: New test fails (checker logic not implemented yet).

**Step 3: Implement checker judge logic**

In the testcase loop, after the user program runs successfully, if `judgeType === "checker"`:

1. Write user stdout to `stdout.txt` in the workspace
2. Write expected output to `expected.txt`
3. Write checker script to `checker.py`
4. Run: `python3 checker.py stdin.txt expected.txt stdout.txt`
5. Parse exit code: 0 = AC, 1 = WA
6. Parse stdout as score (optional), stderr as feedback

The checker runs as a second `runSolution` call with a special workspace request that includes the checker script and output files.

Add helper function `runCheckerScript`:

```typescript
async function runCheckerScript(
  input: {
    checkerScript: string;
    expectedStdout: string;
    memoryLimitMb: number;
    stdin: string;
    testcaseId: string;
    timeLimitMs: number;
    userStdout: string;
    workspaceSessionId: string;
    inputFiles?: Record<string, string>;
  },
  dependencies: JudgeSubmissionDependencies
): Promise<{ accepted: boolean; feedback: string; score: number | null }> {
  const result = await dependencies.runSolution({
    draft: {
      language: "python",
      mode: "practice",
      problemSlug: "checker",
      sourceCode: input.checkerScript
    },
    memoryLimitMb: input.memoryLimitMb,
    stdin: "",
    testcaseId: `checker-${input.testcaseId}`,
    timeLimitMs: input.timeLimitMs,
    workspaceSessionId: input.workspaceSessionId,
    // Override: the checker needs custom files, not normal judge.sh
    _checkerFiles: {
      checkerScript: input.checkerScript,
      expectedStdout: input.expectedStdout,
      stdin: input.stdin,
      userStdout: input.userStdout,
      inputFiles: input.inputFiles
    }
  } as any);

  // ...parse result
}
```

Actually, a cleaner approach: modify `buildJudgeWorkspaceRequest` to accept a `checkerMode` option that generates a different set of files and command. OR, add a new function `buildCheckerWorkspaceRequest` that creates the checker execution request.

The simpler approach: add `buildCheckerWorkspaceRequest` function:

```typescript
export function buildCheckerWorkspaceRequest(input: {
  checkerScript: string;
  expectedStdout: string;
  inputFiles?: Record<string, string>;
  memoryLimitMb: number;
  stdin: string;
  testcaseId: string;
  timeLimitMs: number;
  userStdout: string;
  workspaceSessionId: string;
}): WorkspaceRunRequest {
  const files: Array<{ content: string; path: string }> = [
    { content: input.checkerScript, path: "checker.py" },
    { content: input.stdin, path: "stdin.txt" },
    { content: input.expectedStdout, path: "expected.txt" },
    { content: input.userStdout, path: "user_output.txt" },
    {
      content: "checker:\n\t@python3 checker.py stdin.txt expected.txt user_output.txt\n",
      path: "Makefile"
    }
  ];

  if (input.inputFiles) {
    for (const [name, content] of Object.entries(input.inputFiles)) {
      files.push({ content, path: name });
    }
  }

  return workspaceRunRequestSchema.parse({
    command: "make checker",
    files,
    mode: "practice",
    timeoutMs: resolveExecutionTimeoutMs(input.timeLimitMs),
    workspaceSessionId: input.workspaceSessionId
  });
}
```

Then in `judgeSubmissionAgainstTestcases`, branch on `judgeType === "checker"` to call checker after user program runs.

**Step 4: Run tests**

Run: `cd apps/worker && pnpm vitest run`
Expected: All tests pass including the new checker test.

**Step 5: Add test for checker returning WA**

```typescript
it("returns wrong_answer when checker exits 1", async () => {
  const { judgeSubmissionAgainstTestcases } = await import("../src/services/submission-runner");
  const runSolution = vi
    .fn()
    .mockResolvedValueOnce({
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      status: "succeeded",
      stdout: "999\n"
    })
    .mockResolvedValueOnce({
      durationMs: 5,
      exitCode: 1,
      stderr: "Expected 3, got 999",
      status: "failed",
      stdout: ""
    });

  const result = await judgeSubmissionAgainstTestcases(
    {
      checkerScript: 'import sys\nprint("Expected 3, got 999", file=sys.stderr)\nsys.exit(1)\n',
      draft: {
        language: "python",
        mode: "practice",
        problemSlug: "float-check",
        sourceCode: "print(999)\n"
      },
      judgeType: "checker",
      testcases: [
        {
          expectedStdout: "3\n",
          id: "tc_01",
          isHidden: false,
          stdin: "1 2\n",
          weight: 1
        }
      ]
    },
    { runSolution }
  );

  expect(result.verdict).toBe("wrong_answer");
});
```

**Step 6: Run tests, verify pass**

Run: `cd apps/worker && pnpm vitest run`

**Step 7: Commit**

```bash
git add apps/worker/src/services/submission-runner.ts apps/worker/tests/submission-runner.test.ts
git commit -m "feat: add checker judge mode with script-based evaluation"
```

---

### Task 6: Add interactive judge mode

**Files:**

- Modify: `apps/worker/src/services/submission-runner.ts`
- Modify: `apps/worker/tests/submission-runner.test.ts`

**Step 1: Write failing test for interactive mode**

```typescript
it("accepts via interactive judge when interactor exits 0", async () => {
  const { judgeSubmissionAgainstTestcases } = await import("../src/services/submission-runner");

  // Interactive mode: single sandbox run with interactor + user program connected via pipes
  const runSolution = vi.fn().mockResolvedValueOnce({
    durationMs: 15,
    exitCode: 0,
    stderr: "100\nGuessed correctly",
    status: "succeeded",
    stdout: ""
  });

  const result = await judgeSubmissionAgainstTestcases(
    {
      draft: {
        language: "python",
        mode: "practice",
        problemSlug: "guess-number",
        sourceCode: "print(42)\nresponse = input()\n"
      },
      interactorScript: 'import sys\nprint("100", file=sys.stderr)\nsys.exit(0)\n',
      judgeType: "interactive",
      testcases: [
        {
          id: "tc_01",
          isHidden: false,
          stdin: "42\n",
          weight: 1
        }
      ]
    },
    { runSolution }
  );

  expect(result.verdict).toBe("accepted");
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm vitest run`

**Step 3: Implement interactive judge**

For interactive mode, the sandbox runs a wrapper script that:

1. Creates two named pipes (FIFOs)
2. Starts the interactor writing to one pipe, reading from another
3. Starts the user program reading from the first pipe, writing to the second
4. Waits for both processes
5. Reports interactor's exit code as the verdict

Add `buildInteractiveWorkspaceRequest`:

```typescript
export function buildInteractiveWorkspaceRequest(input: {
  draft: SubmissionDraft;
  inputFiles?: Record<string, string>;
  interactorScript: string;
  memoryLimitMb: number;
  stdin: string;
  testcaseId: string;
  timeLimitMs: number;
  workspaceSessionId: string;
}): WorkspaceRunRequest {
  const languageSpec = getLanguageSpec(input.draft.language);
  if (!languageSpec) {
    throw new Error(`Unsupported language: ${input.draft.language}`);
  }

  const interactiveScript = [
    "#!/bin/sh",
    "set -eu",
    "",
    "# Compile user program if needed",
    languageSpec.runtimeScript.includes("gcc") ||
    languageSpec.runtimeScript.includes("g++") ||
    languageSpec.runtimeScript.includes("javac") ||
    languageSpec.runtimeScript.includes("rustc")
      ? languageSpec.runtimeScript.split("\n").slice(0, -1).join("\n") // compile only, no exec
      : "",
    "",
    "# Set up pipes",
    "mkfifo /tmp/to_user /tmp/from_user",
    "",
    "# Run user program: reads from to_user, writes to from_user",
    `${getRunCommand(languageSpec)} < /tmp/to_user > /tmp/from_user &`,
    "USER_PID=$!",
    "",
    "# Run interactor: writes to to_user (user's stdin), reads from from_user (user's stdout)",
    "python3 interactor.py input.txt > /tmp/to_user < /tmp/from_user",
    "INTERACTOR_EXIT=$?",
    "",
    "# Clean up",
    "wait $USER_PID 2>/dev/null || true",
    "rm -f /tmp/to_user /tmp/from_user",
    "exit $INTERACTOR_EXIT"
  ].join("\n");

  const files: Array<{ content: string; path: string }> = [
    { content: input.draft.sourceCode, path: languageSpec.sourceFileName },
    { content: input.interactorScript, path: "interactor.py" },
    { content: input.stdin, path: "input.txt" },
    { content: interactiveScript, path: "interactive.sh" },
    { content: "interactive:\n\t@sh interactive.sh\n", path: "Makefile" }
  ];

  if (input.inputFiles) {
    for (const [name, content] of Object.entries(input.inputFiles)) {
      files.push({ content, path: name });
    }
  }

  return workspaceRunRequestSchema.parse({
    command: "make interactive",
    files,
    mode: input.draft.mode,
    timeoutMs: resolveExecutionTimeoutMs(input.timeLimitMs),
    workspaceSessionId: input.workspaceSessionId
  });
}
```

Note: The `getRunCommand` helper extracts just the run command from the language spec (e.g. `./main`, `java Main`, `python3 main.py`). Add it:

```typescript
function getRunCommand(spec: JudgeLanguageSpec): string {
  const lines = spec.runtimeScript.split("\n");
  const execLine = lines.find((l) => l.startsWith("exec "));
  if (execLine) {
    // Remove "exec " prefix and "< stdin.txt" suffix
    return execLine.replace("exec ", "").replace(/ < stdin\.txt$/, "");
  }
  return lines[lines.length - 1]?.replace("exec ", "").replace(/ < stdin\.txt$/, "") ?? "";
}
```

In the main judge function, when `judgeType === "interactive"`:

- Build interactive workspace request
- Run it
- Parse interactor stderr: line 1 = score, line 2+ = feedback
- Exit code 0 = AC, 1 = WA

**Step 4: Run tests**

Run: `cd apps/worker && pnpm vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/services/submission-runner.ts apps/worker/tests/submission-runner.test.ts
git commit -m "feat: add interactive judge mode with pipe-based communication"
```

---

### Task 7: Update worker processor to pass new context

**Files:**

- Modify: `apps/worker/src/processors.ts`

**Step 1: Update `processSubmission` to pass new fields**

The `judgeContext` from `getSubmissionJudgeContext` now includes `judgeType`, `submissionType`, `checkerScript`, `interactorScript`, `templates`. Pass them through:

```typescript
const result = await judgeSubmissionAgainstTestcases(
  {
    checkerScript: judgeContext.checkerScript,
    draft: payload.draft,
    interactorScript: judgeContext.interactorScript,
    judgeType: judgeContext.judgeType,
    memoryLimitMb: judgeContext.memoryLimitMb,
    submissionType: judgeContext.submissionType,
    templates: judgeContext.templates,
    testcases: judgeContext.testcases,
    timeLimitMs: judgeContext.timeLimitMs
  },
  {
    runSolution: async (input) => {
      return executeJudgeRun(input, remoteSandboxConfig);
    }
  }
);
```

**Step 2: Verify types compile**

Run: `cd apps/worker && pnpm tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/worker/src/processors.ts
git commit -m "feat: pass judge type and templates through worker processor"
```

---

### Task 8: Write test for function-mode source assembly

**Files:**

- Modify: `apps/worker/tests/submission-runner.test.ts`

**Step 1: Write test**

```typescript
it("assembles function-mode source before judging", async () => {
  const { judgeSubmissionAgainstTestcases } = await import("../src/services/submission-runner");

  const runSolution = vi.fn().mockResolvedValue({
    durationMs: 8,
    exitCode: 0,
    stderr: "",
    status: "succeeded",
    stdout: "3\n"
  });

  const result = await judgeSubmissionAgainstTestcases(
    {
      draft: {
        language: "python",
        mode: "practice",
        problemSlug: "add-function",
        sourceCode: "def add(a, b):\n    return a + b\n"
      },
      submissionType: "function",
      templates: [
        {
          driverCode: "# __USER_CODE__\na, b = map(int, input().split())\nprint(add(a, b))\n",
          insertionMarker: "# __USER_CODE__",
          language: "python",
          templateCode: "def add(a, b):\n    # write your code here\n    pass\n"
        }
      ],
      testcases: [
        {
          expectedStdout: "3\n",
          id: "tc_01",
          isHidden: false,
          stdin: "1 2\n",
          weight: 1
        }
      ]
    },
    { runSolution }
  );

  expect(result.verdict).toBe("accepted");
  // Verify the assembled source was passed to sandbox, not the raw user code
  const callArgs = runSolution.mock.calls[0]?.[0];
  expect(callArgs.draft.sourceCode).toContain("def add(a, b):");
  expect(callArgs.draft.sourceCode).toContain("print(add(a, b))");
});
```

**Step 2: Write test for missing template error**

```typescript
it("returns compile_error when function-mode has no template for language", async () => {
  const { judgeSubmissionAgainstTestcases } = await import("../src/services/submission-runner");
  const runSolution = vi.fn();

  const result = await judgeSubmissionAgainstTestcases(
    {
      draft: {
        language: "cpp",
        mode: "practice",
        problemSlug: "add-function",
        sourceCode: "int add(int a, int b) { return a + b; }"
      },
      submissionType: "function",
      templates: [
        {
          driverCode: "# __USER_CODE__\nprint(add(1,2))\n",
          insertionMarker: "# __USER_CODE__",
          language: "python",
          templateCode: "def add(a, b): pass"
        }
      ],
      testcases: [
        {
          expectedStdout: "3\n",
          id: "tc_01",
          isHidden: false,
          stdin: "1 2\n",
          weight: 1
        }
      ]
    },
    { runSolution }
  );

  expect(result.verdict).toBe("compile_error");
  expect(result.feedback).toContain("No template found");
  expect(runSolution).not.toHaveBeenCalled();
});
```

**Step 3: Run all tests**

Run: `cd apps/worker && pnpm vitest run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/worker/tests/submission-runner.test.ts
git commit -m "test: add function-mode and checker-mode judge tests"
```

---

### Task 9: Update seed data with function-mode and checker-mode examples

**Files:**

- Modify: `packages/db/prisma/seed.ts`

**Step 1: Add a function-mode problem to seed**

Add to the `problemDefs` array a new problem that uses `submissionType: "function"` and `judgeType: "standard"`. After creating the problem, also create `ProblemTemplate` entries.

Example problem: "Add Two Numbers" — function mode, user writes `add(a, b)`.

After the problem upsert loop, add template creation:

```typescript
// Create templates for function-mode problems
const addProblem = await prisma.problem.findUnique({ where: { slug: "add-two-numbers" } });
if (addProblem) {
  await prisma.problemTemplate.upsert({
    create: {
      driverCode: "# __USER_CODE__\na, b = map(int, input().split())\nprint(add(a, b))\n",
      insertionMarker: "# __USER_CODE__",
      language: "python",
      problemId: addProblem.id,
      templateCode: "def add(a, b):\n    # Write your solution here\n    pass\n"
    },
    update: {
      driverCode: "# __USER_CODE__\na, b = map(int, input().split())\nprint(add(a, b))\n",
      templateCode: "def add(a, b):\n    # Write your solution here\n    pass\n"
    },
    where: {
      problemId_language: {
        language: "python",
        problemId: addProblem.id
      }
    }
  });

  await prisma.problemTemplate.upsert({
    create: {
      driverCode:
        "#include <iostream>\nusing namespace std;\n// __USER_CODE__\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << add(a, b) << endl;\n    return 0;\n}\n",
      insertionMarker: "// __USER_CODE__",
      language: "cpp",
      problemId: addProblem.id,
      templateCode:
        "int add(int a, int b) {\n    // Write your solution here\n    return 0;\n}\n"
    },
    update: {
      driverCode:
        "#include <iostream>\nusing namespace std;\n// __USER_CODE__\nint main() {\n    int a, b;\n    cin >> a >> b;\n    cout << add(a, b) << endl;\n    return 0;\n}\n",
      templateCode:
        "int add(int a, int b) {\n    // Write your solution here\n    return 0;\n}\n"
    },
    where: {
      problemId_language: {
        language: "cpp",
        problemId: addProblem.id
      }
    }
  });
}
```

**Step 2: Add a checker-mode problem to seed**

Add a problem with `judgeType: "checker"` and `checkerScript` that checks float tolerance.

**Step 3: Run seed**

Run: `cd packages/db && pnpm db:seed`
Expected: Seed completes successfully.

**Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat: add function-mode and checker-mode example problems to seed"
```

---

### Task 10: Update sandbox Dockerfile for interactive mode

**Files:**

- Modify: `infra/docker/sandbox-runner.Dockerfile`

**Step 1: Verify mkfifo availability**

The interactive judge uses `mkfifo` for named pipes. Check that the Alpine-based sandbox image has it (it should — it's in coreutils which is included in Alpine base). If not, add it.

**Step 2: Verify /tmp is writable**

The sandbox runs with `--tmpfs /tmp:rw,nosuid,nodev,size=64m`. Named pipes will be created in `/tmp`. This should work already since `/tmp` is a tmpfs mount.

**Step 3: No changes needed if mkfifo is available**

Run: `docker run --rm nojv-sandbox:local which mkfifo`
Expected: `/usr/bin/mkfifo` or similar path.

If missing: add `coreutils` to the Dockerfile's `apk add` line.

**Step 4: Commit only if changes were needed**

---

### Task 11: Final integration verification

**Step 1: Run full test suite**

Run: `cd apps/worker && pnpm vitest run`
Expected: All tests pass.

**Step 2: Run type checks across all packages**

Run: `pnpm -r tsc --noEmit`
Expected: No type errors.

**Step 3: Run linter**

Run: `pnpm lint`
Expected: No new lint errors.

**Step 4: Manual smoke test (if Docker available)**

1. Start services: `docker compose up -d postgres redis`
2. Run seed: `cd packages/db && pnpm db:seed`
3. Start worker: `cd apps/worker && pnpm dev`
4. Start web: `cd apps/web && pnpm dev`
5. Submit a standard problem via API — verify accepted
6. Submit a function-mode problem via API — verify source assembly + accepted

**Step 5: Final commit if any fixes needed**
