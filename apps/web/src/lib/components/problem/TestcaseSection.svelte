<script lang="ts">
  import JSZip from "jszip";
  import { m } from "$lib/paraglide/messages.js";
  import { monoTextareaClassName } from "$lib/utils";
  import { detectSubtasksFromFiles, type ParsedCase, type SubtaskConfig } from "./detect-subtasks";
  const smallInputClassName =
    "w-full rounded-[1.5rem] border border-border bg-white/60 px-2 py-1.5 text-xs font-mono";
  const pillButton =
    "inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white";

  interface ExampleCase {
    stdin: string;
    expectedStdout: string;
  }

  interface Props {
    examples: ExampleCase[];
    isEditMode: boolean;
    parsedCases: ParsedCase[];
    subtasks: SubtaskConfig[];
  }

  let {
    examples = $bindable(),
    isEditMode,
    parsedCases = $bindable(),
    subtasks = $bindable()
  }: Props = $props();

  // Internal state
  let regexPattern = $state("(\\d+)-(\\d+)");
  let inExt = $state(".in");
  let outExt = $state(".out");
  let zipFileName = $state<string | null>(null);

  function updateExample(index: number, patch: Partial<ExampleCase>) {
    examples = examples.map((e, i) => (i === index ? { ...e, ...patch } : e));
  }

  async function handleZipUpload(file: File) {
    try {
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
        // TODO: surface error to parent if needed
        return;
      }
      parsedCases = result.cases;
      subtasks = result.subtasks;
      zipFileName = file.name;
    } catch {
      // TODO: surface error to parent if needed
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

  let totalPoints = $derived(subtasks.reduce((sum, s) => sum + s.points, 0));
</script>

<!-- Examples Section -->
<div class="mt-2 border-t border-border pt-5">
  <div class="flex items-center justify-between gap-4">
    <div>
      <p class="text-sm font-bold">{m.testcases_sampleCases()}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {m.testcases_sampleCasesHint()}
      </p>
    </div>
  </div>

  <div class="mt-3 grid gap-3">
    {#each examples as ex, i (`example-${i}`)}
      <div
        class="rounded-[1.5rem] border border-border bg-white/50 px-4 py-3"
      >
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm font-semibold">{m.testcases_case()} {i + 1}</p>
          {#if examples.length > 1}
            <button
              class="text-sm text-red-700"
              onclick={() => (examples = examples.filter((_, idx) => idx !== i))}
              type="button"
            >
              {m.testcases_remove()}
            </button>
          {/if}
        </div>
        <div class="mt-3 grid gap-4 lg:grid-cols-2">
          <label class="text-sm text-muted-foreground">
            {m.testcases_stdin()}
            <textarea
              class={monoTextareaClassName}
              oninput={(e) =>
                updateExample(i, { stdin: (e.target as HTMLTextAreaElement).value })}
              value={ex.stdin}
            ></textarea>
          </label>
          <label class="text-sm text-muted-foreground">
            {m.testcases_expectedStdout()}
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
      {m.testcases_addCase()}
    </button>
  </div>
</div>

<!-- ZIP Upload Section -->
{#if !isEditMode}
  <div class="mt-2 border-t border-border pt-5">
    <p class="text-sm font-bold">{m.testcases_hiddenCases()}</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {m.testcases_uploadZipHint()}
    </p>

    <div
      class="mt-3 rounded-[1.5rem] border border-dashed border-border bg-white/40 px-4 py-3"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">Regex</span>
          <input
            class="{smallInputClassName} w-48"
            oninput={(e) => (regexPattern = (e.target as HTMLInputElement).value)}
            placeholder="(\d+)-(\d+)"
            value={regexPattern}
          />
        </div>
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">Input Extension</span>
          <input
            class="{smallInputClassName} w-16"
            oninput={(e) => (inExt = (e.target as HTMLInputElement).value)}
            value={inExt}
          />
        </div>
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">Output Extension</span>
          <input
            class="{smallInputClassName} w-16"
            oninput={(e) => (outExt = (e.target as HTMLInputElement).value)}
            value={outExt}
          />
        </div>
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">
            {m.testcases_uploadZip()}
          </span>
          <input
            accept=".zip"
            class="text-xs file:mr-2 file:rounded-full file:border file:border-border file:bg-white/60 file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-white"
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
          <span class="text-xs text-muted-foreground">
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
          <span class="text-xs text-muted-foreground">Auto-split into:</span>
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              class="rounded-full border px-3 py-1 text-xs font-medium transition {subtasks.length ===
              n
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-white'}"
              onclick={() => autoSplitEvenly(n)}
              type="button"
            >
              {n}
            </button>
          {/each}
          <button class="ml-2 {pillButton} py-1 text-xs" onclick={addSubtask} type="button">
            + {m.testcases_addSubtask()}
          </button>
        </div>

        <div class="grid gap-4">
          {#each subtasks as subtask, si (`subtask-${si}`)}
            <div
              class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4"
            >
              <div class="flex flex-wrap items-center gap-3">
                <input
                  class="rounded-[1.5rem] border border-border bg-white/60 px-3 py-2 text-sm font-semibold"
                  oninput={(e) =>
                    updateSubtask(si, { name: (e.target as HTMLInputElement).value })}
                  value={subtask.name}
                />
                <label
                  class="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  {m.testcases_subtaskPoints()}
                  <input
                    class="w-20 rounded-[1.5rem] border border-border bg-white/60 px-2 py-2 text-sm"
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
                    {m.testcases_removeSubtask()}
                  </button>
                {/if}
              </div>
              <textarea
                class="mt-3 w-full rounded-[1.5rem] border border-border bg-white/60 px-3 py-2 text-sm"
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
