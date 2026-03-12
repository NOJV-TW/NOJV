<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import { apiErrorSchema, supportedLanguages, type JudgeType, type Language, type SubmissionType } from "@nojv/core";

  const judgeTypeLabel: Record<string, () => string> = {
    standard: () => m.admin_standard(),
    checker: () => m.admin_checker(),
    interactive: () => m.admin_interactive()
  };

  import type { ProblemDetail, TemplateInfo } from "$lib/types";
  import { type ParsedCase, type SubtaskConfig } from "./detect-subtasks";
  import CodeTemplateEditor from "./CodeTemplateEditor.svelte";
  import TestcaseSection from "./TestcaseSection.svelte";

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-border bg-white/60 px-3 py-3 text-sm";
  const textareaClassName = `${inputClassName} min-h-28 resize-y`;
  const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;
  interface ExampleCase {
    stdin: string;
    expectedStdout: string;
  }

  interface Props {
    mode?: "create" | "edit";
    initialData?: ProblemDetail;
    formData: any;
  }

  let { mode = "create", initialData, formData }: Props = $props();
  const init = untrack(() => initialData);

  const CHECKER_TEMPLATE = `import sys

input_data = open(sys.argv[1]).read()
expected = open(sys.argv[2]).read()
actual = open(sys.argv[3]).read()

if actual.strip() == expected.strip():
    print("AC")
    sys.exit(0)
else:
    print("WA")
    sys.exit(1)
`;

  const INTERACTOR_TEMPLATE = `import sys

# Read from stdin (contestant output), write to stdout (contestant input)
t = int(input())
print(t)
sys.stdout.flush()
`;

  // --- superForm setup ---
  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    dataType: 'json',
    onResult({ result }) {
      if (result.type === 'success' && result.data) {
        void handlePostSubmit(result.data);
      }
    }
  });

  // --- Non-schema UI state ---

  // Tags
  let tagInput = $state("");
  let tagInputEl: HTMLInputElement;

  // Template data (for function mode)
  let templatesByLang = $state<Partial<Record<Language, TemplateInfo>>>(
    init?.templates
      ? { ...init.templates }
      : {}
  );

  // Starter code (for full_source mode)
  let starterByLang = $state<Partial<Record<Language, string>>>(
    init?.starterByLanguage
      ? { ...init.starterByLanguage }
      : {}
  );

  // Example test cases (submitted separately via createTestcaseSet)
  let examples = $state<ExampleCase[]>(
    init?.samples?.map((s) => ({ stdin: s.input, expectedStdout: s.output })) ??
    [{ stdin: "", expectedStdout: "" }]
  );

  // Test data from ZIP
  let parsedCases = $state<ParsedCase[]>([]);
  let subtasks = $state<SubtaskConfig[]>([]);

  // Post-submission error (testcase creation failures)
  let postError = $state<string | null>(null);

  let isEditMode = $derived(mode === "edit");

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag.length > 0 && !$form.tags!.includes(tag)) {
      $form.tags = [...($form.tags ?? []), tag];
    }
    tagInput = "";
  }

  function removeTag(index: number) {
    $form.tags = ($form.tags ?? []).filter((_: string, i: number) => i !== index);
  }

  function handleTagKeyDown(event: KeyboardEvent) {
    if ((event.key === " " || event.key === "Enter") && tagInput.trim().length > 0) {
      event.preventDefault();
      addTag(tagInput);
    }
    if (event.key === "Backspace" && tagInput === "" && ($form.tags ?? []).length > 0) {
      $form.tags = ($form.tags ?? []).slice(0, -1);
    }
  }

  async function postAction(actionName: string, data: Record<string, string>): Promise<void> {
    const fd = new FormData();
    for (const [key, value] of Object.entries(data)) {
      fd.set(key, value);
    }
    const response = await fetch(`?/${actionName}`, { method: "POST", body: fd });

    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new Error(parsed.success ? parsed.data.message : `Action ${actionName} failed.`);
    }
  }

  // Populate templates/starterByLanguage into form data before submission via $effect
  $effect(() => {
    if ($form.submissionType === "function") {
      $form.templates = supportedLanguages
        .filter((lang) => templatesByLang[lang]?.driverCode)
        .map((lang) => ({
          driverCode: templatesByLang[lang]!.driverCode,
          insertionMarker: templatesByLang[lang]!.insertionMarker || "// __USER_CODE__",
          language: lang,
          templateCode: templatesByLang[lang]!.templateCode
        }));
    } else {
      $form.templates = [];
    }
  });

  // Set slug for create mode (computed from title)
  $effect(() => {
    if (!isEditMode && $form.title) {
      const rawSlug = $form.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      $form.slug = rawSlug.length >= 3 ? rawSlug : `problem-${String(Date.now())}`;
    }
  });

  // Ensure summary has a default
  $effect(() => {
    if ($form.summary === undefined) {
      $form.summary = "";
    }
  });

  async function handlePostSubmit(resultData: { slug?: unknown }) {
    postError = null;

    try {
      if (isEditMode) {
        const slug = init?.slug ?? "";
        goto(`/problems/${slug}`);
      } else {
        const slug = String(resultData.slug ?? "");

        const validExamples = examples.filter((e) => e.stdin.trim().length > 0);
        if (validExamples.length > 0) {
          await postAction("createTestcaseSet", {
            slug,
            data: JSON.stringify({
              cases: validExamples,
              isHidden: false,
              name: "Examples",
              weight: 0
            })
          });
        }

        await Promise.all(
          subtasks
            .filter((subtask) => subtask.caseIndices.length > 0)
            .map((subtask) =>
              postAction("createTestcaseSet", {
                slug,
                data: JSON.stringify({
                  cases: subtask.caseIndices.map((idx) => ({
                    stdin: parsedCases[idx]?.stdin ?? "",
                    expectedStdout: parsedCases[idx]?.expectedStdout ?? ""
                  })),
                  isHidden: true,
                  name: subtask.name,
                  weight: subtask.points
                })
              })
            )
        );

        goto(`/problems/${slug}`);
      }
    } catch (issue) {
      postError = issue instanceof Error ? issue.message : "Post-submission action failed.";
    }
  }

</script>

<section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
  <form class="grid gap-4" method="POST" action={isEditMode ? "?/update" : "?/create"} use:enhance>
    <!-- Title -->
    <label class="text-sm text-muted-foreground">
      {m.admin_title()}
      <input
        class={inputClassName}
        bind:value={$form.title}
        required
      />
      {#if $errors.title}<span class="text-sm text-red-700">{$errors.title}</span>{/if}
    </label>

    <!-- Tags -->
    <div class="text-sm text-muted-foreground">
      <span>{m.admin_tags()}</span>
      <div
        class="mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-white/60 px-3 py-2"
        onclick={() => tagInputEl?.focus()}
        role="textbox"
        tabindex="-1"
        onkeydown={() => {}}
      >
        {#each $form.tags ?? [] as tag, index (tag)}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {tag}
            <button
              class="ml-0.5 text-primary/60 hover:text-primary"
              onclick={() => removeTag(index)}
              type="button"
            >
              &times;
            </button>
          </span>
        {/each}
        <input
          bind:this={tagInputEl}
          class="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"
          oninput={(e) => (tagInput = (e.target as HTMLInputElement).value)}
          onkeydown={handleTagKeyDown}
          placeholder={m.admin_tagsPlaceholder()}
          value={tagInput}
        />
      </div>
      {#if $errors.tags}<span class="text-sm text-red-700">{$errors.tags}</span>{/if}
    </div>

    <!-- Difficulty + Visibility -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-muted-foreground">
        {m.admin_difficulty()}
        <select
          class={inputClassName}
          bind:value={$form.difficulty}
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
        {#if $errors.difficulty}<span class="text-sm text-red-700">{$errors.difficulty}</span>{/if}
      </label>
      <label class="text-sm text-muted-foreground">
        {m.admin_visibility()}
        <select
          class={inputClassName}
          bind:value={$form.visibility}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
        {#if $errors.visibility}<span class="text-sm text-red-700">{$errors.visibility}</span>{/if}
      </label>
    </div>

    <!-- Judge Type -->
    <div class="text-sm text-muted-foreground">
      <span>{m.admin_judgeType()}</span>
      <div class="mt-2 flex gap-4">
        {#each ["standard", "checker", "interactive"] as type (type)}
          <label class="flex items-center gap-2 text-sm">
            <input
              checked={$form.judgeType === type}
              class="accent-primary"
              name="judgeType"
              onchange={() => ($form.judgeType = type as JudgeType)}
              type="radio"
              value={type}
            />
            {judgeTypeLabel[type]?.() ?? type}
          </label>
        {/each}
      </div>
      {#if $errors.judgeType}<span class="text-sm text-red-700">{$errors.judgeType}</span>{/if}
    </div>

    {#if $form.judgeType === "checker"}
      <label class="text-sm text-muted-foreground">
        {m.admin_checkerScript()}
        <textarea
          class="{monoTextareaClassName} min-h-40"
          bind:value={$form.checkerScript}
          placeholder={CHECKER_TEMPLATE}
        ></textarea>
        {#if $errors.checkerScript}<span class="text-sm text-red-700">{$errors.checkerScript}</span>{/if}
      </label>
    {/if}

    {#if $form.judgeType === "interactive"}
      <label class="text-sm text-muted-foreground">
        {m.admin_interactorScript()}
        <textarea
          class="{monoTextareaClassName} min-h-40"
          bind:value={$form.interactorScript}
          placeholder={INTERACTOR_TEMPLATE}
        ></textarea>
        {#if $errors.interactorScript}<span class="text-sm text-red-700">{$errors.interactorScript}</span>{/if}
      </label>
    {/if}

    <!-- Checker/Interactor Language — not part of schema, keep as local -->
    {#if $form.judgeType === "checker" || $form.judgeType === "interactive"}
      <label class="text-sm text-muted-foreground">
        {m.admin_checkerLanguage()}
        <select
          class={inputClassName}
          value="python"
        >
          <option value="python">Python</option>
          <option value="cpp">C++</option>
        </select>
      </label>
    {/if}

    <!-- Time / Memory Limits -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-muted-foreground">
        {m.admin_timeLimit()}
        <input
          class={inputClassName}
          min="100"
          max="30000"
          bind:value={$form.timeLimitMs}
          type="number"
        />
        {#if $errors.timeLimitMs}<span class="text-sm text-red-700">{$errors.timeLimitMs}</span>{/if}
      </label>
      <label class="text-sm text-muted-foreground">
        {m.admin_memoryLimit()}
        <input
          class={inputClassName}
          min="16"
          max="1024"
          bind:value={$form.memoryLimitMb}
          type="number"
        />
        {#if $errors.memoryLimitMb}<span class="text-sm text-red-700">{$errors.memoryLimitMb}</span>{/if}
      </label>
    </div>

    <!-- Submission Type -->
    <div class="text-sm text-muted-foreground">
      <span>{m.admin_submissionType()}</span>
      <div class="mt-2 flex gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input
            checked={$form.submissionType === "full_source"}
            class="accent-primary"
            name="submissionType"
            onchange={() => ($form.submissionType = "full_source")}
            type="radio"
            value="full_source"
          />
          {m.admin_fullSource()}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input
            checked={$form.submissionType === "function"}
            class="accent-primary"
            name="submissionType"
            onchange={() => ($form.submissionType = "function")}
            type="radio"
            value="function"
          />
          {m.admin_functionTemplate()}
        </label>
      </div>
      {#if $errors.submissionType}<span class="text-sm text-red-700">{$errors.submissionType}</span>{/if}
    </div>

    <CodeTemplateEditor
      submissionType={$form.submissionType ?? "full_source"}
      bind:templatesByLang
      bind:starterByLang
    />

    <!-- Statement -->
    <label class="text-sm text-muted-foreground">
      {m.admin_statement()}
      <textarea
        class="{textareaClassName} min-h-40"
        bind:value={$form.statement}
        required
      ></textarea>
      {#if $errors.statement}<span class="text-sm text-red-700">{$errors.statement}</span>{/if}
    </label>

    <!-- Input / Output Format -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-muted-foreground">
        {m.admin_inputFormat()}
        <textarea
          class={textareaClassName}
          bind:value={$form.inputFormat}
        ></textarea>
        {#if $errors.inputFormat}<span class="text-sm text-red-700">{$errors.inputFormat}</span>{/if}
      </label>
      <label class="text-sm text-muted-foreground">
        {m.admin_outputFormat()}
        <textarea
          class={textareaClassName}
          bind:value={$form.outputFormat}
        ></textarea>
        {#if $errors.outputFormat}<span class="text-sm text-red-700">{$errors.outputFormat}</span>{/if}
      </label>
    </div>

    <TestcaseSection
      bind:examples
      {isEditMode}
      bind:parsedCases
      bind:subtasks
    />

    <!-- Submit -->
    <button
      class="mt-2 inline-flex w-fit rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={$submitting}
      type="submit"
    >
      {#if $submitting}
        {isEditMode ? m.admin_updating() : m.common_creating()}
      {:else}
        {isEditMode ? m.admin_updateProblem() : m.admin_createProblem()}
      {/if}
    </button>
    {#if $formMessage}
      <div
        class="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      >
        {$formMessage}
      </div>
    {/if}
    {#if postError}
      <div
        class="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {postError}
      </div>
    {/if}
  </form>
</section>
