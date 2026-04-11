# Silent-Failure & problemIds Validation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock teachers who currently cannot create assignments or contests. Fix the `problemIds` schema rejection bug and replace silent server failures with visible errors. This is "Phase 0" of the larger course experience redesign — a narrow, shippable patch that buys time for the bigger refactor.

**Architecture:** Add one shared `FormError.svelte` component. Change three forms to send `{ kind, text }` typed messages through superForm's `message()` helper (replacing the current `fail(400, { form, error })` pattern that the UI silently discards). Relax the `problemIds` Zod schema from `slugSchema` to plain non-empty string. Add the missing `name` attribute to contest language checkboxes.

**Tech Stack:** SvelteKit 2 · Svelte 5 · sveltekit-superforms · Zod 4 · Tailwind 4 · Vitest · Playwright

**Parallelism:** Tasks 1, 2, 3, 4 are independent (Wave 1). Tasks 5, 6, 7 each depend on 1 plus one of {2,3,4} (Wave 2, parallel within wave). Task 8 depends on Wave 2 completion (Wave 3).

---

## File Structure

**New files:**

- `apps/web/src/lib/components/ui/FormError.svelte` — presentational red banner for top-of-form server errors. Consumes `message` prop.
- `apps/web/src/lib/types/form-message.ts` — shared discriminated-union type `FormMessage = { kind: "success" | "error"; text: string }` used by every form that adopts the new pattern.
- `tests/unit/core/contest-schemas.test.ts` — unit tests for `contestCreateSchema` (new file; matches the existing `course-schemas.test.ts` neighbor).
- `tests/e2e/teacher-form-errors.test.ts` — Playwright test proving errors now surface in the UI.

**Modified files:**

- `packages/core/src/schemas/course.ts` — line 60: relax `problemIds` validation.
- `packages/core/src/schemas/contest.ts` — line 35: relax `problemIds` validation.
- `apps/web/src/routes/(app)/courses/[slug]/manage/assessments/+page.server.ts` — switch both actions to `message(form, { kind, text }, { status })`.
- `apps/web/src/lib/components/manage/Assessments.svelte` — render `FormError` + typed `$formMessage`.
- `apps/web/src/lib/components/manage/Contests.svelte` — render `FormError` + typed `$formMessage` + fix missing `name` on language checkboxes.
- `apps/web/src/routes/(app)/contests/create/+page.server.ts` — same `message()` switch.
- `apps/web/src/routes/(app)/contests/create/+page.svelte` — render `FormError` + typed `$formMessage`.
- `tests/unit/core/course-schemas.test.ts` — add problemIds regression test.

**Intentionally untouched:** `apps/web/src/lib/components/manage/Members.svelte` (its form doesn't silent-fail today; adopting the new pattern there is out of scope for this phase).

---

## Task 1: Create shared FormError component and FormMessage type

**Goal:** Provide a single reusable top-of-form error banner plus a typed message shape used across the three broken forms.

**Files:**

- Create: `apps/web/src/lib/types/form-message.ts`
- Create: `apps/web/src/lib/components/ui/FormError.svelte`

- [ ] **Step 1: Write the FormMessage type**

```ts
// apps/web/src/lib/types/form-message.ts

/**
 * Shared discriminated union for superForm `message()` payloads.
 * Lets a single superForm's `$formMessage` represent both success banners
 * and server-side failures, so templates can distinguish them by `kind`.
 */
export type FormMessage = {
  kind: "success" | "error";
  text: string;
};
```

- [ ] **Step 2: Write the FormError component**

```svelte
<!-- apps/web/src/lib/components/ui/FormError.svelte -->
<script lang="ts">
  import { AlertCircle } from "@lucide/svelte";

  interface Props {
    message: string | null | undefined;
  }

  let { message }: Props = $props();
</script>

{#if message}
  <div
    role="alert"
    aria-live="polite"
    class="mb-4 flex items-start gap-3 rounded-lg border border-destructive/40 border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-destructive"
    data-testid="form-error"
  >
    <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
    <p class="text-body-sm font-medium leading-snug">{message}</p>
  </div>
{/if}
```

- [ ] **Step 3: Typecheck the new files**

Run: `pnpm --filter @nojv/web typecheck`
Expected: exits 0. No type errors. (The new files are unused so far, so this verifies they compile in isolation.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/types/form-message.ts apps/web/src/lib/components/ui/FormError.svelte
git commit -m "feat(web): add shared FormError component and FormMessage type"
```

---

## Task 2: Relax `courseAssessmentCreateSchema.problemIds` validation

**Goal:** Stop rejecting `problem_*` IDs that actually exist in the database. The current `slugSchema` regex forbids underscores, so every submission fails.

**Files:**

- Modify: `packages/core/src/schemas/course.ts:60`
- Modify: `tests/unit/core/course-schemas.test.ts`

- [ ] **Step 1: Add failing unit test**

Append this block to `tests/unit/core/course-schemas.test.ts` (inside the existing `describe("courseAssessmentCreateSchema", ...)` block, before its closing `});`):

```ts
it("accepts problemIds containing underscores (actual DB ids like problem_warmup-sum)", () => {
  const result = courseAssessmentCreateSchema.safeParse({
    closesAt: "2026-03-30T12:00:00.000Z",
    courseSlug: "os-lab-spring-2026",
    opensAt: "2026-03-18T12:00:00.000Z",
    dueAt: "2026-03-25T12:00:00.000Z",
    problemIds: ["problem_warmup-sum", "problem_add-two-numbers"],
    slug: "hw1-process-warmup",
    summary: "Process warmup with two easy problems.",
    title: "HW1 Process Warmup"
  });

  expect(result.success).toBe(true);
});

it("rejects empty problemIds array", () => {
  const result = courseAssessmentCreateSchema.safeParse({
    closesAt: "2026-03-30T12:00:00.000Z",
    courseSlug: "os-lab-spring-2026",
    opensAt: "2026-03-18T12:00:00.000Z",
    problemIds: [],
    slug: "hw1-process-warmup",
    summary: "Process warmup with two easy problems.",
    title: "HW1 Process Warmup"
  });

  expect(result.success).toBe(false);
});

it("rejects problemIds whose entries are empty strings", () => {
  const result = courseAssessmentCreateSchema.safeParse({
    closesAt: "2026-03-30T12:00:00.000Z",
    courseSlug: "os-lab-spring-2026",
    opensAt: "2026-03-18T12:00:00.000Z",
    problemIds: [""],
    slug: "hw1-process-warmup",
    summary: "Process warmup with two easy problems.",
    title: "HW1 Process Warmup"
  });

  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test:unit -- course-schemas`
Expected: the first new test ("accepts problemIds containing underscores...") FAILS with a Zod `invalid_format` / `slugFormat` error. The other two new tests may already pass because they don't depend on the underscore fix.

- [ ] **Step 3: Change the schema line**

Open `packages/core/src/schemas/course.ts`, locate line 60 which reads:

```ts
    problemIds: z.array(slugSchema).min(1).max(32),
```

Replace it with:

```ts
    problemIds: z.array(z.string().trim().min(1)).min(1).max(32),
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test:unit -- course-schemas`
Expected: all three new tests PASS. Pre-existing tests in `course-schemas.test.ts` still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/course.ts tests/unit/core/course-schemas.test.ts
git commit -m "fix(core): accept raw problem ids in courseAssessmentCreateSchema"
```

---

## Task 3: Relax `contestCreateSchema.problemIds` validation

**Goal:** Identical fix to Task 2, but for the contest schema. Create a new test file matching the neighbor pattern.

**Files:**

- Modify: `packages/core/src/schemas/contest.ts:35`
- Create: `tests/unit/core/contest-schemas.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// tests/unit/core/contest-schemas.test.ts
import { describe, expect, it } from "vitest";

import { contestCreateSchema } from "../../../packages/core/src/index";

const baseContestInput = {
  allowedLanguages: [],
  endsAt: "2026-05-03T17:00:00.000Z",
  frozenAt: undefined,
  ipBindingEnabled: false,
  ipViolationMode: "block",
  ipWhitelistEnabled: false,
  ipWhitelist: [],
  pageLockEnabled: false,
  scoreboardMode: "live",
  scoringMode: "problem_count",
  slug: "midterm-2026",
  startsAt: "2026-05-03T14:00:00.000Z",
  submitCooldownSec: 0,
  summary: "Midterm exam covering sorting and searching.",
  title: "Midterm 2026"
};

describe("contestCreateSchema", () => {
  it("accepts problemIds containing underscores (actual DB ids like problem_warmup-sum)", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: ["problem_warmup-sum", "problem_add-two-numbers"]
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty problemIds array", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects problemIds whose entries are empty strings", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: [""]
    });

    expect(result.success).toBe(false);
  });

  it("still rejects endsAt earlier than startsAt", () => {
    const result = contestCreateSchema.safeParse({
      ...baseContestInput,
      problemIds: ["problem_warmup-sum"],
      startsAt: "2026-05-03T17:00:00.000Z",
      endsAt: "2026-05-03T14:00:00.000Z"
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test:unit -- contest-schemas`
Expected: the first new test fails with `invalid_format` / `slugFormat`. The "endsAt earlier than startsAt" test already passes because that refinement is unchanged.

- [ ] **Step 3: Change the schema line**

Open `packages/core/src/schemas/contest.ts`, locate line 35 which reads:

```ts
  problemIds: z.array(slugSchema).min(1).max(32),
```

Replace it with:

```ts
  problemIds: z.array(z.string().trim().min(1)).min(1).max(32),
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test:unit -- contest-schemas`
Expected: all four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/contest.ts tests/unit/core/contest-schemas.test.ts
git commit -m "fix(core): accept raw problem ids in contestCreateSchema"
```

---

## Task 4: Restore `name` attribute on contest language checkboxes

**Goal:** The allowedLanguages checkboxes in `Contests.svelte` have no `name`, so superForm never sees them and always submits an empty array. Fix the attribute and the `toggleLanguage` binding so selections round-trip.

**Files:**

- Modify: `apps/web/src/lib/components/manage/Contests.svelte:285-289`

- [ ] **Step 1: Inspect the current markup**

Read lines 280-295 of `apps/web/src/lib/components/manage/Contests.svelte`. Confirm the checkbox block currently reads:

```svelte
          {#each supportedLanguages as lang (lang)}
            <label class="flex items-center gap-1.5 text-body-sm">
              <input
                type="checkbox"
                checked={($form.allowedLanguages ?? []).includes(lang)}
                onchange={() => toggleLanguage(lang)}
              />
              {lang}
            </label>
          {/each}
```

The `<input>` is missing `name="allowedLanguages"` and `value={lang}`, which is the root cause.

- [ ] **Step 2: Add the missing attributes**

Replace the `<input>` element above with:

```svelte
              <input
                type="checkbox"
                name="allowedLanguages"
                value={lang}
                checked={($form.allowedLanguages ?? []).includes(lang)}
                onchange={() => toggleLanguage(lang)}
              />
```

This mirrors the equivalent block in `Assessments.svelte:331-337` (which already has `name="allowedLanguages"`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @nojv/web typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/manage/Contests.svelte
git commit -m "fix(web): restore name on contest language checkboxes"
```

---

## Task 5: Wire FormError into assessments server action + component

**Goal:** When the server action fails, the client must see a visible error message. Replace `fail(400, { form, error: msg })` with typed `message()` calls and render `FormError` at the top of the form.

**Depends on:** Task 1 (FormError component + FormMessage type), Task 2 (schema fix so real submissions succeed).

**Files:**

- Modify: `apps/web/src/routes/(app)/courses/[slug]/manage/assessments/+page.server.ts:81-131`
- Modify: `apps/web/src/lib/components/manage/Assessments.svelte:115-398`

- [ ] **Step 1: Update the assessments server action — success path**

Open `apps/web/src/routes/(app)/courses/[slug]/manage/assessments/+page.server.ts`. Locate the `create` action's success return around line 84:

```ts
await createCourseAssessmentRecord(actor, payload);
return message(form, `Published ${payload.title}.`);
```

Replace with:

```ts
await createCourseAssessmentRecord(actor, payload);
return message(form, { kind: "success", text: `Published ${payload.title}.` });
```

- [ ] **Step 2: Update the assessments server action — error path**

In the same file, the `create` action's `catch` block currently reads (around lines 85-88):

```ts
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Assessment publish failed.";
      return fail(400, { form, error: msg });
    }
```

Replace with:

```ts
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Assessment publish failed.";
      return message(form, { kind: "error", text: msg }, { status: 400 });
    }
```

- [ ] **Step 3: Update the `createContest` action the same way**

Same file, around line 125 (success):

```ts
await createContestRecord(actor, payload);
return message(form, `Contest "${payload.title}" created.`);
```

→

```ts
await createContestRecord(actor, payload);
return message(form, { kind: "success", text: `Contest "${payload.title}" created.` });
```

Around line 127-129 (error):

```ts
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return fail(400, { contestForm: form, error: msg });
    }
```

→

```ts
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return message(form, { kind: "error", text: msg }, { status: 400 });
    }
```

Note: the original returns `{ contestForm: form, error: msg }` under a different key. That was redundant because the page already loads `contestForm` in its loader. Using `message(form, ...)` here is correct because `form` in this action is the contest form — superForm will route the message back to the `contestForm` instance loaded in the loader because the action returns the validated form as its first argument to `message`.

- [ ] **Step 4: Also drop the now-unused `fail` import**

At the top of the same file, line 8 currently imports both `fail` and `message`-like helpers:

```ts
import { fail } from "@sveltejs/kit";
```

After Steps 2 and 3 there is still one remaining `fail()` call (the `!form.valid` and permission gate cases at lines 63 and 67). Keep the `fail` import — it is still used for those two cases (they don't have a server error string to show; they're flat 400/403s).

- [ ] **Step 5: Import FormError and FormMessage in Assessments.svelte**

Open `apps/web/src/lib/components/manage/Assessments.svelte`. At the end of the `<script>` import block (after the `import { Button } from "$lib/components/ui/button";` line around line 17), add:

```ts
import FormError from "$lib/components/ui/FormError.svelte";
import type { FormMessage } from "$lib/types/form-message";
```

- [ ] **Step 6: Type the superForm message**

Locate line 115 which currently reads:

```ts
const {
  form,
  errors,
  submitting,
  message: formMessage,
  enhance
} = superForm(
  untrack(() => formData),
  {
    dataType: "json",
    invalidateAll: true
  }
);
```

Replace with (add the `Message` generic parameter via a cast helper):

```ts
const {
  form,
  errors,
  submitting,
  message: formMessage,
  enhance
} = superForm<typeof formData.data, FormMessage>(
  untrack(() => formData),
  {
    dataType: "json",
    invalidateAll: true
  }
);
```

- [ ] **Step 7: Replace the message render at the bottom of the form**

Locate lines 397-399:

```svelte
    {#if $formMessage}
      <p class="mt-4 text-body-sm text-success">{$formMessage}</p>
    {/if}
```

Replace with:

```svelte
    {#if $formMessage?.kind === "success"}
      <p class="mt-4 text-body-sm text-success">{$formMessage.text}</p>
    {/if}
```

- [ ] **Step 8: Mount FormError at the top of the form**

Locate the `<form` element around line 297:

```svelte
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/create"
      use:enhance
    >
      <div class="grid gap-3 md:grid-cols-2">
```

Insert the FormError component as the first child of the form, before the `<div class="grid gap-3 md:grid-cols-2">`:

```svelte
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/create"
      use:enhance
    >
      <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />
      <div class="grid gap-3 md:grid-cols-2">
```

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @nojv/web typecheck`
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/routes/(app)/courses/[slug]/manage/assessments/+page.server.ts apps/web/src/lib/components/manage/Assessments.svelte
git commit -m "fix(web): surface assessment form errors via FormError banner"
```

---

## Task 6: Wire FormError into manage contests component

**Goal:** Do the equivalent of Task 5 for `Contests.svelte`. The server changes already landed in Task 5 Steps 3-4 (the `createContest` action lives in the same `+page.server.ts`); this task only touches the component.

**Depends on:** Task 1 (FormError component), Task 3 (contest schema fix), Task 4 (checkbox name fix), Task 5 (server already converted to `message()`).

**Files:**

- Modify: `apps/web/src/lib/components/manage/Contests.svelte:115-337`

- [ ] **Step 1: Import FormError and FormMessage**

At the end of the existing `<script>` import block (after the `import SystemTextToggle ...` line around line 16), add:

```ts
import FormError from "$lib/components/ui/FormError.svelte";
import type { FormMessage } from "$lib/types/form-message";
```

- [ ] **Step 2: Type the superForm message**

Locate line 115:

```ts
const {
  form,
  errors,
  submitting,
  message: formMessage,
  enhance
} = superForm(
  untrack(() => formData),
  { dataType: "json", invalidateAll: true }
);
```

Replace with:

```ts
const {
  form,
  errors,
  submitting,
  message: formMessage,
  enhance
} = superForm<typeof formData.data, FormMessage>(
  untrack(() => formData),
  {
    dataType: "json",
    invalidateAll: true
  }
);
```

- [ ] **Step 3: Replace the message render at the bottom**

Locate lines 336-338:

```svelte
    {#if $formMessage}
      <p class="mt-4 text-body-sm text-success">{$formMessage}</p>
    {/if}
```

Replace with:

```svelte
    {#if $formMessage?.kind === "success"}
      <p class="mt-4 text-body-sm text-success">{$formMessage.text}</p>
    {/if}
```

- [ ] **Step 4: Mount FormError at the top of the contest form**

Find the `<form>` tag for the contest creation form (the one with `action="?/createContest"`). Insert as its first child:

```svelte
      <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @nojv/web typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/manage/Contests.svelte
git commit -m "fix(web): surface contest form errors via FormError banner"
```

---

## Task 7: Wire FormError into standalone `/contests/create` page

**Goal:** The top-level "Create contest" page (not inside a course manage) uses the same `contestCreateSchema` and the same silent-failure pattern. Fix it the same way.

**Depends on:** Task 1 (FormError), Task 3 (schema fix).

**Files:**

- Modify: `apps/web/src/routes/(app)/contests/create/+page.server.ts`
- Modify: `apps/web/src/routes/(app)/contests/create/+page.svelte`

- [ ] **Step 1: Read the current server action**

Read `apps/web/src/routes/(app)/contests/create/+page.server.ts`. Locate the action that validates with `contestFormSchema` and calls `createContestRecord`. Its success path should read something like `return message(form, \`Contest "${payload.title}" created.\`);`, and its error path should use `return fail(400, { form, error: msg });`.

- [ ] **Step 2: Convert success path**

```ts
return message(form, `Contest "${payload.title}" created.`);
```

→

```ts
return message(form, { kind: "success", text: `Contest "${payload.title}" created.` });
```

- [ ] **Step 3: Convert error path**

```ts
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return fail(400, { form, error: msg });
    }
```

→

```ts
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Contest creation failed.";
      return message(form, { kind: "error", text: msg }, { status: 400 });
    }
```

Keep the `fail` import (still used for `!form.valid` / permission gates).

- [ ] **Step 4: Update the Svelte component imports**

Open `apps/web/src/routes/(app)/contests/create/+page.svelte`. At the end of the existing `<script>` import block, add:

```ts
import FormError from "$lib/components/ui/FormError.svelte";
import type { FormMessage } from "$lib/types/form-message";
```

- [ ] **Step 5: Type the superForm message**

Find the `superForm(...)` call in the component's `<script>`. Add the `FormMessage` generic the same way as Task 5 Step 6:

```ts
const {
  form,
  errors,
  submitting,
  message: formMessage,
  enhance
} = superForm<typeof formData.data, FormMessage>(formData, {
  dataType: "json"
});
```

(Keep any other options the existing call passes — e.g. `invalidateAll` — unchanged. Only the generic types and the possible wrapper differ.)

- [ ] **Step 6: Replace the existing success banner**

The component currently renders `{#if $formMessage}` somewhere below the form with a success-styled `<p>`. Change it to:

```svelte
{#if $formMessage?.kind === "success"}
  <p class="mt-4 text-body-sm text-success">{$formMessage.text}</p>
{/if}
```

- [ ] **Step 7: Mount FormError at the top of the form**

Add as the first child of the `<form>` element:

```svelte
  <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @nojv/web typecheck`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/routes/(app)/contests/create/+page.server.ts apps/web/src/routes/(app)/contests/create/+page.svelte
git commit -m "fix(web): surface standalone contest create errors via FormError banner"
```

---

## Task 8: E2E test — teacher can actually create assignment and contest

**Goal:** Close the loop with a Playwright test that navigates through the real browser flow, creates an assignment via the manage page, creates a contest via the same page, and asserts they appear in the listing. Also assert that a deliberately-invalid submission shows the `FormError` banner.

**Depends on:** Tasks 5, 6 (and transitively 1, 2, 3, 4, 7).

**Files:**

- Create: `tests/e2e/teacher-form-errors.test.ts`

- [ ] **Step 1: Read the existing e2e conventions**

Read `tests/e2e/course-manage.test.ts` for reference. Note the `teacherAuth` storage state path and the URL pattern `/courses/os-lab-spring-2026/manage/assessments`. The seeded course/user must still be valid for this test to run (`pnpm db:seed` before running e2e).

- [ ] **Step 2: Write the happy-path + error-path test**

```ts
// tests/e2e/teacher-form-errors.test.ts
import { test, expect } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

test.describe("Teacher form error visibility", () => {
  test("teacher can create an assessment and sees a success banner", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");

    // Fill the assessment form with a unique slug + real problem ids.
    const uniqueSuffix = Date.now().toString(36);
    const slug = `hw-fix-${uniqueSuffix}`;
    await page
      .getByRole("textbox", { name: /測驗標題|Assessment title/i })
      .fill(`Fix HW ${uniqueSuffix}`);
    await page.getByRole("textbox", { name: /assessment-slug/i }).fill(slug);
    await page
      .getByRole("textbox", { name: /測驗摘要|Assessment summary/i })
      .fill("Regression test for silent failure fix.");
    // The problemIdsText textarea has placeholder "problem-one, problem-two"
    await page.getByPlaceholder("problem-one, problem-two").first().fill("problem_warmup-sum");

    await page.getByRole("button", { name: /發布測驗|Publish assessment/i }).click();

    await expect(page.getByText(`Published Fix HW ${uniqueSuffix}.`)).toBeVisible({
      timeout: 10_000
    });
    await context.close();
  });

  test("teacher sees a visible error banner when assessment creation fails", async ({
    browser
  }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");

    // Use a problem id that does not exist — server will throw NotFoundError,
    // which must now surface through the FormError banner.
    await page
      .getByRole("textbox", { name: /測驗標題|Assessment title/i })
      .fill("Never Published");
    await page
      .getByRole("textbox", { name: /assessment-slug/i })
      .fill("never-published-regression");
    await page
      .getByRole("textbox", { name: /測驗摘要|Assessment summary/i })
      .fill("Intentional failure to test error surfacing.");
    await page
      .getByPlaceholder("problem-one, problem-two")
      .first()
      .fill("problem_does_not_exist_zzzz");

    await page.getByRole("button", { name: /發布測驗|Publish assessment/i }).click();

    await expect(page.getByTestId("form-error")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("form-error")).toContainText(/not found/i);
    await context.close();
  });

  test("teacher can create a contest and sees a success banner", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();
    await page.goto("/courses/os-lab-spring-2026/manage/assessments");

    const uniqueSuffix = Date.now().toString(36);
    const slug = `quiz-fix-${uniqueSuffix}`;
    await page
      .getByRole("textbox", { name: /競賽標題|Contest title/i })
      .fill(`Fix Quiz ${uniqueSuffix}`);
    await page.getByRole("textbox", { name: /contest-slug/i }).fill(slug);
    await page
      .getByRole("textbox", { name: /競賽摘要|Contest summary/i })
      .fill("Regression contest to verify form error fix.");
    await page.getByPlaceholder("problem-one, problem-two").last().fill("problem_warmup-sum");

    await page.getByRole("button", { name: /建立競賽|Create Contest/i }).click();

    await expect(page.getByText(`Contest "Fix Quiz ${uniqueSuffix}" created.`)).toBeVisible({
      timeout: 10_000
    });
    await context.close();
  });
});
```

- [ ] **Step 3: Ensure seeded test data exists**

Run: `pnpm db:seed`
Expected: exits 0 with seeded teacher + `os-lab-spring-2026` course + `problem_warmup-sum` etc.

- [ ] **Step 4: Run the new e2e test**

Run: `pnpm test:e2e -- teacher-form-errors`
Expected: all three tests PASS. If Playwright can't find the role-accessible names because of i18n (language switcher state), adjust the regexes to match whichever locale the fixture saved with.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/teacher-form-errors.test.ts
git commit -m "test(e2e): cover teacher assignment + contest form error surfacing"
```

---

## Post-task verification

- [ ] **Final step: run the full CI verify pipeline**

Run: `pnpm ci:verify`
Expected: exits 0. All lint, format, typecheck, build, and unit tests pass. If e2e is not part of `ci:verify` in this repo (it is usually local-only per root `package.json`), also run `pnpm test:e2e -- teacher-form-errors` one more time against a fresh DB.

---

## Self-review checklist

- [x] **Spec coverage:** Phase 0 of the course experience redesign spec is fully addressed — silent failure removed in all three current form sites, `problemIds` validation relaxed in both core schemas, missing checkbox `name` fixed.
- [x] **Placeholder scan:** No "TBD", "TODO", "implement similar", or "add appropriate handling" text in any task.
- [x] **Type consistency:** `FormMessage = { kind: "success" | "error"; text: string }` is defined in Task 1 and consistently consumed in Tasks 5, 6, 7 with the same field names and the same generic form `superForm<typeof formData.data, FormMessage>(...)`. `FormError` prop is `message: string | null | undefined` everywhere.
- [x] **Out of scope acknowledged:** Problem picker UI, slug removal, route rewrite, new course list, new member bulk-paste flow — all intentionally deferred to Phase 1+ plans. This plan only ships the unblocker.
