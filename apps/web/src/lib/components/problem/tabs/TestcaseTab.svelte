<script lang="ts">
  import JSZip from "jszip";
  import { invalidateAll } from "$app/navigation";
  import { Plus } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import TestcaseSetCard from "$lib/components/problem/testcase/TestcaseSetCard.svelte";
  import HelpTooltip from "$lib/components/ui/HelpTooltip.svelte";
  import { detectSubtasksFromFiles, type ParsedCase, type SubtaskConfig } from "../detect-subtasks";
  import { postProblemAction } from "$lib/utils/actions";

  interface TestcaseData {
    id: string;
    ordinal: number;
    stdin: string;
    expectedStdout: string | null;
  }

  interface TestcaseSetData {
    id: string;
    name: string;
    isHidden: boolean;
    weight: number;
    testcases: TestcaseData[];
  }

  interface Props {
    testcaseSets: TestcaseSetData[];
    problemId: string;
  }

  let { testcaseSets, problemId }: Props = $props();

  const pillButton =
    "inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-accent";
  const smallInputClassName =
    "w-full rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-2 py-1.5 text-xs font-mono";

  // Derived sets
  let sampleSets = $derived(testcaseSets.filter((s) => s.weight === 0));
  let subtaskSets = $derived(testcaseSets.filter((s) => s.weight > 0));

  // Add new set form
  let showAddForm = $state(false);
  let newSetName = $state("");
  let newSetWeight = $state(0);
  let newSetIsHidden = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // ZIP upload state
  let regexPattern = $state("(\\d+)-(\\d+)");
  let inExt = $state(".in");
  let outExt = $state(".out");
  let zipFileName = $state<string | null>(null);
  let parsedCases = $state<ParsedCase[]>([]);
  let subtasks = $state<SubtaskConfig[]>([]);
  let uploadSaving = $state(false);

  let totalPoints = $derived(subtasks.reduce((sum, s) => sum + s.points, 0));

  async function addNewSet() {
    if (!newSetName.trim()) return;
    saving = true;
    error = null;
    try {
      await postProblemAction(problemId, "createTestcaseSet", {
        data: JSON.stringify({
          name: newSetName.trim(),
          weight: newSetWeight,
          isHidden: newSetIsHidden,
          cases: [{ stdin: "", expectedStdout: "" }]
        })
      });
      newSetName = "";
      newSetWeight = 0;
      newSetIsHidden = true;
      showAddForm = false;
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to create testcase set.";
    } finally {
      saving = false;
    }
  }

  const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50 MB

  async function handleZipUpload(file: File) {
    if (file.size > MAX_ZIP_SIZE) {
      error = `ZIP file too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is 50MB.`;
      return;
    }
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
        error = result.error;
        return;
      }
      parsedCases = result.cases;
      subtasks = result.subtasks;
      zipFileName = file.name;
      error = null;
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

  async function uploadSubtasks() {
    uploadSaving = true;
    error = null;
    try {
      await Promise.all(
        subtasks
          .filter((subtask) => subtask.caseIndices.length > 0)
          .map((subtask) =>
            postProblemAction(problemId, "createTestcaseSet", {
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
      parsedCases = [];
      subtasks = [];
      zipFileName = null;
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to upload subtasks.";
    } finally {
      uploadSaving = false;
    }
  }
</script>

<div class="space-y-6">
  <!-- Sample sets (weight=0) -->
  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <div class="mb-4">
      <p class="text-sm font-bold">{m.testcases_sampleCases()}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {m.testcases_sampleCasesHint()}
      </p>
    </div>

    {#if sampleSets.length === 0}
      <p class="text-sm text-muted-foreground">{m.testcases_noSampleSets()}</p>
    {:else}
      <div class="space-y-3">
        {#each sampleSets as set (set.id)}
          <TestcaseSetCard {set} {problemId} />
        {/each}
      </div>
    {/if}
  </section>

  <!-- Subtask sets (weight>0) -->
  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <div class="mb-4">
      <p class="text-sm font-bold">{m.testcases_hiddenCases()}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {m.testcases_hiddenCasesHint()}
      </p>
    </div>

    {#if subtaskSets.length === 0}
      <p class="text-sm text-muted-foreground">{m.testcases_noSubtaskSets()}</p>
    {:else}
      <div class="space-y-3">
        {#each subtaskSets as set (set.id)}
          <TestcaseSetCard {set} {problemId} />
        {/each}
      </div>
    {/if}
  </section>

  <!-- Add new set -->
  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <p class="text-sm font-bold">{m.testcases_authorTestcases()}</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {m.testcases_authorTestcasesSubtitle()}
    </p>

    {#if showAddForm}
      <div class="mt-4 space-y-3">
        <div class="flex flex-wrap items-end gap-3">
          <label class="grid gap-1">
            <span class="text-xs font-medium text-muted-foreground">{m.testcases_setName()}</span>
            <input
              class="rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
              bind:value={newSetName}
              placeholder="e.g. Examples, Subtask 1"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs font-medium text-muted-foreground">{m.testcases_weight()} <HelpTooltip text={m.admin_helpSetWeight()} /></span>
            <input
              class="w-20 rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
              type="number"
              min="0"
              bind:value={newSetWeight}
            />
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="accent-primary"
              bind:checked={newSetIsHidden}
            />
            {m.testcases_hidden()} <HelpTooltip text={m.admin_helpSetHidden()} />
          </label>
        </div>
        <div class="flex gap-2">
          <button
            class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-70"
            onclick={addNewSet}
            disabled={saving || !newSetName.trim()}
            type="button"
          >
            {saving ? m.testcases_saving() : m.testcases_createButton()}
          </button>
          <button
            class="rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5"
            onclick={() => (showAddForm = false)}
            type="button"
          >
            {m.common_cancel()}
          </button>
        </div>
      </div>
    {:else}
      <button
        class="mt-3 inline-flex items-center gap-2 {pillButton}"
        onclick={() => (showAddForm = true)}
        type="button"
      >
        <Plus class="h-4 w-4" />
        {m.testcases_createButton()}
      </button>
    {/if}
  </section>

  <!-- ZIP upload section -->
  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <p class="text-sm font-bold">{m.testcases_uploadZip()}</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {m.testcases_uploadZipHint()}
    </p>

    <div
      class="mt-3 rounded-[1.5rem] border border-dashed border-border bg-[color:var(--color-panel)] px-4 py-3"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">
            {m.testcases_regex()} <HelpTooltip text={m.testcases_zipStructureHint()} />
          </span>
          <input
            class="{smallInputClassName} w-48"
            oninput={(e) => (regexPattern = (e.target as HTMLInputElement).value)}
            placeholder="(\d+)-(\d+)"
            value={regexPattern}
          />
        </div>
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">{m.testcases_inputExtension()}</span>
          <input
            class="{smallInputClassName} w-16"
            oninput={(e) => (inExt = (e.target as HTMLInputElement).value)}
            value={inExt}
          />
        </div>
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">{m.testcases_outputExtension()}</span>
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
            class="text-xs file:mr-2 file:rounded-full file:border file:border-border file:bg-[color:var(--color-panel)] file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-accent"
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
            class="rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
          >
            {m.testcases_casesUploaded({ fileName: zipFileName ?? "", count: parsedCases.length })}
          </span>
          <span class="text-xs text-muted-foreground">
            {m.testcases_subtasksDetected({ count: subtasks.length })}
          </span>
          <span
            class="text-xs font-medium {totalPoints === 100
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'}"
          >
            {totalPoints}/100 pts
          </span>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground">{m.testcases_autoSplitInto()}</span>
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              class="rounded-full border px-3 py-1 text-xs font-medium transition {subtasks.length ===
              n
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-accent'}"
              onclick={() => autoSplitEvenly(n)}
              type="button"
            >
              {n}
            </button>
          {/each}
        </div>

        <div class="grid gap-4">
          <div class="flex items-center justify-end gap-2 text-sm">
            <span class="text-muted-foreground">{m.testcases_totalWeight()}:</span>
            <span
              class="font-bold tabular-nums {totalPoints === 100
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'}"
            >
              {totalPoints}/100
            </span>
          </div>
          {#each subtasks as subtask, si (`subtask-${si}`)}
            <div
              class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4"
            >
              <div class="flex flex-wrap items-center gap-3">
                <label class="grid gap-1">
                  <span class="text-xs font-medium text-muted-foreground">{m.testcases_subtaskLabel()}</span>
                  <input
                    class="rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm font-semibold"
                    oninput={(e) =>
                      updateSubtask(si, { name: (e.target as HTMLInputElement).value })}
                    value={subtask.name}
                  />
                </label>
                <label class="grid gap-1">
                  <span class="text-xs font-medium text-muted-foreground">{m.testcases_subtaskWeight()}</span>
                  <div class="flex items-center gap-1">
                    <input
                      class="w-20 rounded-[1.5rem] border-2 border-primary/30 bg-[color:var(--color-panel)] px-2 py-2 text-sm font-bold text-primary"
                      min="0"
                      oninput={(e) =>
                        updateSubtask(si, {
                          points: Number((e.target as HTMLInputElement).value) || 0
                        })}
                      type="number"
                      value={subtask.points}
                    />
                    <span class="text-xs text-muted-foreground">pts</span>
                  </div>
                </label>
                <span
                  class="mt-auto rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400"
                >
                  {m.testcases_casesCount({ count: subtask.caseIndices.length })}
                </span>
                {#if subtasks.length > 1}
                  <button
                    class="ml-auto mt-auto text-sm text-red-700 dark:text-red-400 hover:text-red-900"
                    onclick={() => (subtasks = subtasks.filter((_, i) => i !== si))}
                    type="button"
                  >
                    {m.testcases_removeSubtask()}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <button
          class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-70"
          onclick={uploadSubtasks}
          disabled={uploadSaving || subtasks.length === 0}
          type="button"
        >
          {uploadSaving ? m.testcases_saving() : m.testcases_uploadSubtasks({ count: subtasks.length })}
        </button>
      </div>
    {/if}
  </section>

  {#if error}
    <div
      class="rounded-2xl border border-red-300 dark:border-red-700 bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400"
    >
      {error}
    </div>
  {/if}
</div>
