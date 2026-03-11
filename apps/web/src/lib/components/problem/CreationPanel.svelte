<script lang="ts">
  import { goto } from "$app/navigation";
  import { t } from "svelte-i18n";
  import { supportedLanguages, type JudgeType, type Language, type SubmissionType } from "@nojv/domain";

  import type { ProblemDetail, TemplateInfo } from "$lib/types";

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
  const textareaClassName = `${inputClassName} min-h-28 resize-y`;
  const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;
  const smallInputClassName =
    "w-full rounded-xl border border-[color:var(--color-border)] bg-white/80 px-2 py-1.5 text-xs font-mono";
  const pillButton =
    "inline-flex rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white";

  interface ExampleCase {
    stdin: string;
    expectedStdout: string;
  }

  interface ParsedCase {
    stdin: string;
    expectedStdout: string;
    sourceFile: string;
  }

  interface SubtaskConfig {
    name: string;
    description: string;
    points: number;
    caseIndices: number[];
  }

  interface Props {
    mode?: "create" | "edit";
    initialData?: ProblemDetail;
  }

  let { mode = "create", initialData }: Props = $props();

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

  function detectSubtasksFromFiles(
    files: { name: string; content: string }[],
    regexPattern: string,
    inExt: string,
    outExt: string
  ): { cases: ParsedCase[]; subtasks: SubtaskConfig[]; error?: string } {
    let regex: RegExp;
    try {
      regex = new RegExp(`^${regexPattern}$`);
    } catch {
      return { cases: [], subtasks: [], error: "Invalid regex pattern" };
    }

    const bySubtask = new Map<
      string,
      Map<string, { in?: string; out?: string; fileName: string }>
    >();

    for (const file of files) {
      const baseName = file.name.includes("/")
        ? (file.name.split("/").pop() ?? file.name)
        : file.name;
      const isIn = baseName.endsWith(inExt);
      const isOut = baseName.endsWith(outExt);
      if (!isIn && !isOut) continue;

      const ext = isIn ? inExt : outExt;
      const stem = baseName.slice(0, -ext.length);
      const match = regex.exec(stem);
      if (!match?.[1] || !match[2]) continue;

      const subtaskId = match[1];
      const caseId = match[2];

      if (!bySubtask.has(subtaskId)) {
        bySubtask.set(subtaskId, new Map());
      }
      const cases = bySubtask.get(subtaskId);
      if (!cases) continue;
      if (!cases.has(caseId)) {
        cases.set(caseId, { fileName: stem });
      }
      const entry = cases.get(caseId);
      if (!entry) continue;
      if (isIn) entry.in = file.content;
      if (isOut) entry.out = file.content;
    }

    if (bySubtask.size === 0) {
      return { cases: [], subtasks: [], error: "No files matched the pattern" };
    }

    const allCases: ParsedCase[] = [];
    const subtasks: SubtaskConfig[] = [];
    const sortedSubtaskIds = [...bySubtask.keys()].sort((a, b) => Number(a) - Number(b));

    for (const subtaskId of sortedSubtaskIds) {
      const casesMap = bySubtask.get(subtaskId);
      if (!casesMap) continue;
      const sortedCaseIds = [...casesMap.keys()].sort((a, b) => Number(a) - Number(b));
      const indices: number[] = [];

      for (const caseId of sortedCaseIds) {
        const entry = casesMap.get(caseId);
        if (!entry) continue;
        indices.push(allCases.length);
        allCases.push({
          stdin: entry.in ?? "",
          expectedStdout: entry.out ?? "",
          sourceFile: `${entry.fileName}${inExt}`
        });
      }

      subtasks.push({
        name: `Subtask ${subtaskId}`,
        description: "",
        points: Math.round(100 / sortedSubtaskIds.length),
        caseIndices: indices
      });
    }

    return { cases: allCases, subtasks };
  }

  // Basic fields
  let title = $state(initialData?.title ?? "");
  let difficulty = $state<"easy" | "medium" | "hard">(initialData?.difficulty ?? "easy");
  let visibility = $state<"public" | "private">(initialData?.visibility ?? "private");
  let statement = $state(initialData?.statement ?? "");
  let inputFormat = $state(initialData?.inputFormat ?? "");
  let outputFormat = $state(initialData?.outputFormat ?? "");

  // Tags
  let tags = $state<string[]>(initialData?.tags ?? []);
  let tagInput = $state("");
  let tagInputEl: HTMLInputElement;

  // Judge type
  let judgeType = $state<JudgeType>(initialData?.judgeType ?? "standard");
  let checkerScript = $state(initialData?.checkerScript ?? "");
  let interactorScript = $state(initialData?.interactorScript ?? "");
  let checkerLanguage = $state<"cpp" | "python">("python");

  // Submission type
  let submissionType = $state<SubmissionType>(initialData?.submissionType ?? "full_source");

  // Time/memory limits
  let timeLimitMs = $state(initialData?.timeLimitMs ?? 1000);
  let memoryLimitMb = $state(initialData?.memoryLimitMb ?? 256);

  // Template data (for function mode)
  let activeTemplateLang = $state<Language>("cpp");
  let templatesByLang = $state<Partial<Record<Language, TemplateInfo>>>(
    initialData?.templates
      ? { ...initialData.templates }
      : {}
  );

  function getTemplate(lang: Language): TemplateInfo {
    return templatesByLang[lang] ?? { driverCode: "", templateCode: "", insertionMarker: "// __USER_CODE__" };
  }

  function updateTemplate(lang: Language, patch: Partial<TemplateInfo>) {
    const current = getTemplate(lang);
    templatesByLang = { ...templatesByLang, [lang]: { ...current, ...patch } };
  }

  // Starter code (for full_source mode)
  let activeStarterLang = $state<Language>("cpp");
  let starterByLang = $state<Partial<Record<Language, string>>>(
    initialData?.starterByLanguage
      ? { ...initialData.starterByLanguage }
      : {}
  );

  function getStarter(lang: Language): string {
    return starterByLang[lang] ?? "";
  }

  function updateStarter(lang: Language, code: string) {
    starterByLang = { ...starterByLang, [lang]: code };
  }

  // Example test cases
  let examples = $state<ExampleCase[]>(
    initialData?.samples?.map((s) => ({ stdin: s.input, expectedStdout: s.output })) ??
    [{ stdin: "", expectedStdout: "" }]
  );

  // Test data from ZIP
  let regexPattern = $state("(\\d+)-(\\d+)");
  let inExt = $state(".in");
  let outExt = $state(".out");
  let parsedCases = $state<ParsedCase[]>([]);
  let subtasks = $state<SubtaskConfig[]>([]);
  let zipFileName = $state<string | null>(null);

  // Form state
  let isSubmitting = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);

  let isEditMode = $derived(mode === "edit");

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag.length > 0 && !tags.includes(tag)) {
      tags = [...tags, tag];
    }
    tagInput = "";
  }

  function removeTag(index: number) {
    tags = tags.filter((_, i) => i !== index);
  }

  function handleTagKeyDown(event: KeyboardEvent) {
    if ((event.key === " " || event.key === "Enter") && tagInput.trim().length > 0) {
      event.preventDefault();
      addTag(tagInput);
    }
    if (event.key === "Backspace" && tagInput === "" && tags.length > 0) {
      tags = tags.slice(0, -1);
    }
  }

  function updateExample(index: number, patch: Partial<ExampleCase>) {
    examples = examples.map((e, i) => (i === index ? { ...e, ...patch } : e));
  }

  async function handleZipUpload(file: File) {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      const allFiles: { name: string; content: string }[] = [];
      const fileNames = Object.keys(zip.files).filter((n) => !zip.files[n]?.dir);

      for (const name of fileNames) {
        const zipEntry = zip.files[name];
        if (!zipEntry) continue;
        const content = await zipEntry.async("string");
        allFiles.push({ name, content });
      }

      const result = detectSubtasksFromFiles(allFiles, regexPattern, inExt, outExt);
      if (result.error) {
        error = result.error;
        return;
      }
      parsedCases = result.cases;
      subtasks = result.subtasks;
      zipFileName = file.name;
    } catch {
      error = "Failed to parse ZIP file.";
    }
  }

  function updateSubtask(index: number, patch: Partial<SubtaskConfig>) {
    subtasks = subtasks.map((s, i) => (i === index ? { ...s, ...patch } : s));
  }

  function autoSplitEvenly(count: number) {
    if (parsedCases.length === 0 || count < 1) return;
    const perGroup = Math.ceil(parsedCases.length / count);
    const newSubtasks: SubtaskConfig[] = [];
    for (let i = 0; i < count; i++) {
      const start = i * perGroup;
      const end = Math.min(start + perGroup, parsedCases.length);
      if (start >= parsedCases.length) break;
      const indices = Array.from({ length: end - start }, (_, k) => start + k);
      newSubtasks.push({
        name: `Subtask ${String(i + 1)}`,
        description: "",
        points: Math.round(100 / count),
        caseIndices: indices
      });
    }
    subtasks = newSubtasks;
  }

  function addSubtask() {
    subtasks = [
      ...subtasks,
      {
        name: `Subtask ${String(subtasks.length + 1)}`,
        description: "",
        points: 0,
        caseIndices: []
      }
    ];
  }

  async function postAction(actionName: string, data: Record<string, string>): Promise<void> {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      formData.set(key, value);
    }
    const response = await fetch(`?/${actionName}`, { method: "POST", body: formData });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `Action ${actionName} failed.`);
    }
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    isSubmitting = true;
    message = null;
    error = null;

    const rawSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slug = initialData?.slug ?? (rawSlug.length >= 3 ? rawSlug : `problem-${String(Date.now())}`);

    try {
      if (isEditMode) {
        await postAction("update", {
          data: JSON.stringify({
            checkerLanguage: (judgeType === "checker" || judgeType === "interactive") ? checkerLanguage : undefined,
            checkerScript: judgeType === "checker" ? checkerScript : undefined,
            difficulty,
            inputFormat,
            interactorScript: judgeType === "interactive" ? interactorScript : undefined,
            judgeType,
            memoryLimitMb,
            outputFormat,
            starterByLanguage: submissionType === "full_source" ? starterByLang : undefined,
            statement,
            submissionType,
            summary: "",
            tags,
            templates: submissionType === "function" ? templatesByLang : undefined,
            timeLimitMs,
            title,
            visibility
          })
        });

        message = `Updated ${title}. Redirecting...`;
        goto(`/problems/${slug}`);
      } else {
        const templateArray = submissionType === "function"
          ? supportedLanguages
              .filter((lang) => templatesByLang[lang]?.driverCode)
              .map((lang) => ({
                driverCode: templatesByLang[lang]!.driverCode,
                insertionMarker: templatesByLang[lang]!.insertionMarker || "// __USER_CODE__",
                language: lang,
                templateCode: templatesByLang[lang]!.templateCode
              }))
          : [];

        await postAction("create", {
          data: JSON.stringify({
            checkerScript: judgeType === "checker" ? checkerScript : undefined,
            difficulty,
            inputFormat,
            interactorScript: judgeType === "interactive" ? interactorScript : undefined,
            judgeType,
            memoryLimitMb,
            outputFormat,
            slug,
            statement,
            submissionType,
            summary: "",
            tags,
            templates: templateArray,
            timeLimitMs,
            title,
            visibility
          })
        });

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

        message = `Created ${title}. Redirecting...`;
        goto(`/problems/${slug}`);
      }
    } catch (issue) {
      error = issue instanceof Error ? issue.message : "Problem creation failed.";
    } finally {
      isSubmitting = false;
    }
  }

  let totalPoints = $derived(subtasks.reduce((sum, s) => sum + s.points, 0));
</script>

<section class="rounded-2xl border border-[color:var(--color-border)] bg-white/60 px-6 py-6">
  <form class="grid gap-4" onsubmit={handleSubmit}>
    <!-- Title -->
    <label class="text-sm text-[color:var(--color-muted)]">
      {$t("admin.title")}
      <input
        class={inputClassName}
        oninput={(e) => (title = (e.target as HTMLInputElement).value)}
        required
        value={title}
      />
    </label>

    <!-- Tags -->
    <div class="text-sm text-[color:var(--color-muted)]">
      <span>{$t("admin.tags")}</span>
      <div
        class="mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-2"
        onclick={() => tagInputEl?.focus()}
        role="textbox"
        tabindex="-1"
        onkeydown={() => {}}
      >
        {#each tags as tag, index (tag)}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[color:var(--color-accent)]"
          >
            {tag}
            <button
              class="ml-0.5 text-[color:var(--color-accent)]/60 hover:text-[color:var(--color-accent)]"
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
          placeholder={$t("admin.tagsPlaceholder")}
          value={tagInput}
        />
      </div>
    </div>

    <!-- Difficulty + Visibility -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.difficulty")}
        <select
          class={inputClassName}
          onchange={(e) =>
            (difficulty = (e.target as HTMLSelectElement).value as
              | "easy"
              | "medium"
              | "hard")}
          value={difficulty}
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>
      </label>
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.visibility")}
        <select
          class={inputClassName}
          onchange={(e) =>
            (visibility = (e.target as HTMLSelectElement).value as "public" | "private")}
          value={visibility}
        >
          <option value="private">private</option>
          <option value="public">public</option>
        </select>
      </label>
    </div>

    <!-- Judge Type -->
    <div class="text-sm text-[color:var(--color-muted)]">
      <span>{$t("admin.judgeType")}</span>
      <div class="mt-2 flex gap-4">
        {#each ["standard", "checker", "interactive"] as type (type)}
          <label class="flex items-center gap-2 text-sm">
            <input
              checked={judgeType === type}
              class="accent-[color:var(--color-accent)]"
              name="judgeType"
              onchange={() => (judgeType = type as JudgeType)}
              type="radio"
              value={type}
            />
            {$t(`admin.${type}`)}
          </label>
        {/each}
      </div>
    </div>

    {#if judgeType === "checker"}
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.checkerScript")}
        <textarea
          class="{monoTextareaClassName} min-h-40"
          oninput={(e) => (checkerScript = (e.target as HTMLTextAreaElement).value)}
          placeholder={CHECKER_TEMPLATE}
          value={checkerScript}
        ></textarea>
      </label>
    {/if}

    {#if judgeType === "interactive"}
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.interactorScript")}
        <textarea
          class="{monoTextareaClassName} min-h-40"
          oninput={(e) => (interactorScript = (e.target as HTMLTextAreaElement).value)}
          placeholder={INTERACTOR_TEMPLATE}
          value={interactorScript}
        ></textarea>
      </label>
    {/if}

    <!-- Checker/Interactor Language -->
    {#if judgeType === "checker" || judgeType === "interactive"}
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.checkerLanguage")}
        <select
          class={inputClassName}
          onchange={(e) =>
            (checkerLanguage = (e.target as HTMLSelectElement).value as "cpp" | "python")}
          value={checkerLanguage}
        >
          <option value="python">Python</option>
          <option value="cpp">C++</option>
        </select>
      </label>
    {/if}

    <!-- Time / Memory Limits -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.timeLimit")}
        <input
          class={inputClassName}
          min="100"
          max="30000"
          oninput={(e) => (timeLimitMs = Number((e.target as HTMLInputElement).value) || 1000)}
          type="number"
          value={timeLimitMs}
        />
      </label>
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.memoryLimit")}
        <input
          class={inputClassName}
          min="16"
          max="1024"
          oninput={(e) => (memoryLimitMb = Number((e.target as HTMLInputElement).value) || 256)}
          type="number"
          value={memoryLimitMb}
        />
      </label>
    </div>

    <!-- Submission Type -->
    <div class="text-sm text-[color:var(--color-muted)]">
      <span>{$t("admin.submissionType")}</span>
      <div class="mt-2 flex gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input
            checked={submissionType === "full_source"}
            class="accent-[color:var(--color-accent)]"
            name="submissionType"
            onchange={() => (submissionType = "full_source")}
            type="radio"
            value="full_source"
          />
          {$t("admin.fullSource")}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input
            checked={submissionType === "function"}
            class="accent-[color:var(--color-accent)]"
            name="submissionType"
            onchange={() => (submissionType = "function")}
            type="radio"
            value="function"
          />
          {$t("admin.functionTemplate")}
        </label>
      </div>
    </div>

    <!-- Starter Code (full_source mode) -->
    {#if submissionType === "full_source"}
      <div class="mt-2 border-t border-[color:var(--color-border)] pt-5">
        <p class="text-sm font-bold">{$t("admin.starterCode")}</p>
        <p class="mt-1 text-xs text-[color:var(--color-muted)]">
          {$t("admin.fullSource")}
        </p>

        <div class="mt-3 flex gap-1 border-b border-[color:var(--color-border)]">
          {#each supportedLanguages as lang (lang)}
            <button
              class="px-3 py-1.5 text-xs font-medium transition {activeStarterLang === lang
                ? 'border-b-2 border-[color:var(--color-accent)] text-[color:var(--color-ink)]'
                : 'text-stone-400 hover:text-stone-600'}"
              onclick={() => (activeStarterLang = lang)}
              type="button"
            >
              {lang}
            </button>
          {/each}
        </div>

        <textarea
          class="{monoTextareaClassName} mt-3 min-h-32"
          oninput={(e) => updateStarter(activeStarterLang, (e.target as HTMLTextAreaElement).value)}
          placeholder="// starter code for {activeStarterLang}"
          value={getStarter(activeStarterLang)}
        ></textarea>
      </div>
    {/if}

    <!-- Template Editor (function mode) -->
    {#if submissionType === "function"}
      <div class="mt-2 border-t border-[color:var(--color-border)] pt-5">
        <p class="text-sm font-bold">{$t("admin.functionTemplate")}</p>
        <p class="mt-1 text-xs text-[color:var(--color-muted)]">
          {$t("admin.templatePreviewHint")}
        </p>

        <div class="mt-3 flex gap-1 border-b border-[color:var(--color-border)]">
          {#each supportedLanguages as lang (lang)}
            <button
              class="px-3 py-1.5 text-xs font-medium transition {activeTemplateLang === lang
                ? 'border-b-2 border-[color:var(--color-accent)] text-[color:var(--color-ink)]'
                : 'text-stone-400 hover:text-stone-600'}"
              onclick={() => (activeTemplateLang = lang)}
              type="button"
            >
              {lang}
            </button>
          {/each}
        </div>

        <div class="mt-3 grid gap-4">
          <label class="text-sm text-[color:var(--color-muted)]">
            {$t("admin.driverCode")}
            <textarea
              class="{monoTextareaClassName} min-h-36"
              oninput={(e) => updateTemplate(activeTemplateLang, { driverCode: (e.target as HTMLTextAreaElement).value })}
              placeholder={"#include <bits/stdc++.h>\nusing namespace std;\n\n// __USER_CODE__\n\nint main() { ... }"}
              value={getTemplate(activeTemplateLang).driverCode}
            ></textarea>
          </label>

          <label class="text-sm text-[color:var(--color-muted)]">
            {$t("admin.templateCode")}
            <textarea
              class="{monoTextareaClassName} min-h-28"
              oninput={(e) => updateTemplate(activeTemplateLang, { templateCode: (e.target as HTMLTextAreaElement).value })}
              placeholder={"int solve(int n) {\n  // your code here\n}"}
              value={getTemplate(activeTemplateLang).templateCode}
            ></textarea>
          </label>

          <label class="text-sm text-[color:var(--color-muted)]">
            {$t("admin.insertionMarker")}
            <input
              class="{inputClassName} font-mono"
              oninput={(e) => updateTemplate(activeTemplateLang, { insertionMarker: (e.target as HTMLInputElement).value })}
              value={getTemplate(activeTemplateLang).insertionMarker}
            />
          </label>
        </div>
      </div>
    {/if}

    <!-- Statement -->
    <label class="text-sm text-[color:var(--color-muted)]">
      {$t("admin.statement")}
      <textarea
        class="{textareaClassName} min-h-40"
        oninput={(e) => (statement = (e.target as HTMLTextAreaElement).value)}
        required
        value={statement}
      ></textarea>
    </label>

    <!-- Input / Output Format -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.inputFormat")}
        <textarea
          class={textareaClassName}
          oninput={(e) => (inputFormat = (e.target as HTMLTextAreaElement).value)}
          value={inputFormat}
        ></textarea>
      </label>
      <label class="text-sm text-[color:var(--color-muted)]">
        {$t("admin.outputFormat")}
        <textarea
          class={textareaClassName}
          oninput={(e) => (outputFormat = (e.target as HTMLTextAreaElement).value)}
          value={outputFormat}
        ></textarea>
      </label>
    </div>

    <!-- Examples Section -->
    <div class="mt-2 border-t border-[color:var(--color-border)] pt-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-bold">{$t("testcases.sampleCases")}</p>
          <p class="mt-1 text-xs text-[color:var(--color-muted)]">
            {$t("testcases.sampleCasesHint")}
          </p>
        </div>
      </div>

      <div class="mt-3 grid gap-3">
        {#each examples as ex, i (`example-${i}`)}
          <div
            class="rounded-xl border border-[color:var(--color-border)] bg-white/50 px-4 py-3"
          >
            <div class="flex items-center justify-between gap-4">
              <p class="text-sm font-semibold">{$t("testcases.case")} {i + 1}</p>
              {#if examples.length > 1}
                <button
                  class="text-sm text-red-700"
                  onclick={() => (examples = examples.filter((_, idx) => idx !== i))}
                  type="button"
                >
                  {$t("testcases.remove")}
                </button>
              {/if}
            </div>
            <div class="mt-3 grid gap-4 lg:grid-cols-2">
              <label class="text-sm text-[color:var(--color-muted)]">
                {$t("testcases.stdin")}
                <textarea
                  class={monoTextareaClassName}
                  oninput={(e) =>
                    updateExample(i, { stdin: (e.target as HTMLTextAreaElement).value })}
                  value={ex.stdin}
                ></textarea>
              </label>
              <label class="text-sm text-[color:var(--color-muted)]">
                {$t("testcases.expectedStdout")}
                <textarea
                  class={monoTextareaClassName}
                  oninput={(e) =>
                    updateExample(i, {
                      expectedStdout: (e.target as HTMLTextAreaElement).value
                    })}
                  value={ex.expectedStdout}
                ></textarea>
              </label>
            </div>
          </div>
        {/each}
        <button
          class="w-fit {pillButton}"
          onclick={() =>
            (examples = [...examples, { stdin: "", expectedStdout: "" }])}
          type="button"
        >
          {$t("testcases.addCase")}
        </button>
      </div>
    </div>

    <!-- ZIP Upload Section -->
    {#if !isEditMode}
      <div class="mt-2 border-t border-[color:var(--color-border)] pt-5">
        <p class="text-sm font-bold">{$t("testcases.hiddenCases")}</p>
        <p class="mt-1 text-xs text-[color:var(--color-muted)]">
          {$t("testcases.uploadZipHint")}
        </p>

        <div
          class="mt-3 rounded-xl border border-dashed border-[color:var(--color-border)] bg-white/40 px-4 py-3"
        >
          <div class="flex flex-wrap items-end gap-3">
            <div class="grid gap-1">
              <span class="text-xs text-[color:var(--color-muted)]">Regex</span>
              <input
                class="{smallInputClassName} w-48"
                oninput={(e) => (regexPattern = (e.target as HTMLInputElement).value)}
                placeholder="(\d+)-(\d+)"
                value={regexPattern}
              />
            </div>
            <div class="grid gap-1">
              <span class="text-xs text-[color:var(--color-muted)]">Input Extension</span>
              <input
                class="{smallInputClassName} w-16"
                oninput={(e) => (inExt = (e.target as HTMLInputElement).value)}
                value={inExt}
              />
            </div>
            <div class="grid gap-1">
              <span class="text-xs text-[color:var(--color-muted)]">Output Extension</span>
              <input
                class="{smallInputClassName} w-16"
                oninput={(e) => (outExt = (e.target as HTMLInputElement).value)}
                value={outExt}
              />
            </div>
            <div class="grid gap-1">
              <span class="text-xs text-[color:var(--color-muted)]">
                {$t("testcases.uploadZip")}
              </span>
              <input
                accept=".zip"
                class="text-xs file:mr-2 file:rounded-full file:border file:border-[color:var(--color-border)] file:bg-white/80 file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-white"
                onchange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) void handleZipUpload(file);
                }}
                type="file"
              />
            </div>
          </div>
        </div>

        {#if parsedCases.length > 0}
          <div class="mt-4 space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <span
                class="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
              >
                {zipFileName} — {parsedCases.length} cases uploaded
              </span>
              <span class="text-xs text-[color:var(--color-muted)]">
                {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""} detected
              </span>
              <span
                class="text-xs font-medium {totalPoints === 100
                  ? 'text-emerald-600'
                  : 'text-amber-600'}"
              >
                {totalPoints}/100 pts
              </span>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-xs text-[color:var(--color-muted)]">Auto-split into:</span>
              {#each [1, 2, 3, 4, 5] as n (n)}
                <button
                  class="rounded-full border px-3 py-1 text-xs font-medium transition {subtasks.length ===
                  n
                    ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]'
                    : 'border-[color:var(--color-border)] hover:bg-white'}"
                  onclick={() => autoSplitEvenly(n)}
                  type="button"
                >
                  {n}
                </button>
              {/each}
              <button class="ml-2 {pillButton} py-1 text-xs" onclick={addSubtask} type="button">
                + {$t("testcases.addSubtask")}
              </button>
            </div>

            <div class="grid gap-4">
              {#each subtasks as subtask, si (`subtask-${si}`)}
                <div
                  class="rounded-2xl border border-[color:var(--color-border)] bg-white/70 px-5 py-4"
                >
                  <div class="flex flex-wrap items-center gap-3">
                    <input
                      class="rounded-xl border border-[color:var(--color-border)] bg-white/80 px-3 py-2 text-sm font-semibold"
                      oninput={(e) =>
                        updateSubtask(si, { name: (e.target as HTMLInputElement).value })}
                      value={subtask.name}
                    />
                    <label
                      class="flex items-center gap-2 text-sm text-[color:var(--color-muted)]"
                    >
                      {$t("testcases.subtaskPoints")}
                      <input
                        class="w-20 rounded-xl border border-[color:var(--color-border)] bg-white/80 px-2 py-2 text-sm"
                        min="0"
                        oninput={(e) =>
                          updateSubtask(si, {
                            points: Number((e.target as HTMLInputElement).value) || 0
                          })}
                        type="number"
                        value={subtask.points}
                      />
                    </label>
                    <span
                      class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                    >
                      {subtask.caseIndices.length} cases
                    </span>
                    {#if subtasks.length > 1}
                      <button
                        class="ml-auto text-sm text-red-700 hover:text-red-900"
                        onclick={() => (subtasks = subtasks.filter((_, i) => i !== si))}
                        type="button"
                      >
                        {$t("testcases.removeSubtask")}
                      </button>
                    {/if}
                  </div>
                  <textarea
                    class="mt-3 w-full rounded-xl border border-[color:var(--color-border)] bg-white/80 px-3 py-2 text-sm"
                    oninput={(e) =>
                      updateSubtask(si, {
                        description: (e.target as HTMLTextAreaElement).value
                      })}
                    placeholder="{subtask.name} description..."
                    rows={2}
                    value={subtask.description}
                  ></textarea>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Submit -->
    <button
      class="mt-2 inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={isSubmitting}
      type="submit"
    >
      {#if isSubmitting}
        {isEditMode ? $t("admin.updating") : $t("common.creating")}
      {:else}
        {isEditMode ? $t("admin.updateProblem") : $t("admin.createProblem")}
      {/if}
    </button>
    {#if message}
      <div
        class="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      >
        {message}
      </div>
    {/if}
    {#if error}
      <div
        class="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {error}
      </div>
    {/if}
  </form>
</section>
