<script lang="ts">
  import JSZip from "jszip";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";
  import {
    detectSubtasksFromFiles,
    type ParsedCase,
    type SubtaskConfig,
  } from "../detect-subtasks";
  import { postProblemAction } from "$lib/utils/actions";

  interface Props {
    problemId: string;
    onError: (msg: string | null) => void;
  }

  let { problemId, onError }: Props = $props();

  const smallInputClassName =
    "w-full rounded-lg border border-border bg-[color:var(--color-panel)] px-2 py-1.5 text-caption font-mono";

  let regexPattern = $state("(\\d\\d)(\\d\\d)");
  let inExt = $state(".in");
  let outExt = $state(".out");
  let zipFileName = $state<string | null>(null);
  let zipRawFiles = $state<{ name: string; content: string }[]>([]);
  let parsedCases = $state<ParsedCase[]>([]);
  let subtasks = $state<SubtaskConfig[]>([]);
  let uploadSaving = $state(false);

  let totalPoints = $derived(subtasks.reduce((sum, s) => sum + s.points, 0));

  const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50 MB

  function translateDetectError(code: string): string {
    switch (code) {
      case "invalid_regex":
        return m.testcases_errorInvalidRegex();
      case "no_files_matched":
        return m.testcases_errorNoFilesMatched({ regex: regexPattern, inExt, outExt });
      default:
        return code;
    }
  }

  function reparse() {
    if (zipRawFiles.length === 0) return;
    const result = detectSubtasksFromFiles(zipRawFiles, regexPattern, inExt, outExt);
    if (result.error) {
      onError(translateDetectError(result.error));
      parsedCases = [];
      subtasks = [];
      return;
    }
    parsedCases = result.cases;
    subtasks = result.subtasks;
    onError(null);
  }

  async function handleZipUpload(file: File) {
    if (file.size > MAX_ZIP_SIZE) {
      onError(m.testcases_zipTooLarge({ size: Math.round(file.size / 1024 / 1024) }));
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

      zipRawFiles = allFiles;
      zipFileName = file.name;
      reparse();
    } catch {
      onError(m.testcases_zipParseError());
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
        caseIndices: indices,
      });
    }
    subtasks = newSubtasks;
  }

  async function uploadSubtasks() {
    uploadSaving = true;
    onError(null);
    try {
      await Promise.all(
        subtasks
          .filter((subtask) => subtask.caseIndices.length > 0)
          .map((subtask) =>
            postProblemAction(problemId, "createTestcaseSet", {
              data: JSON.stringify({
                cases: subtask.caseIndices.map((idx) => ({
                  input: parsedCases[idx]?.input ?? "",
                  output: parsedCases[idx]?.output ?? "",
                })),
                name: subtask.name,
                weight: subtask.points,
              }),
            }),
          ),
      );
      parsedCases = [];
      subtasks = [];
      zipRawFiles = [];
      zipFileName = null;
      await invalidateAll();
    } catch (e) {
      onError(e instanceof Error ? e.message : m.testcases_uploadFailed());
    } finally {
      uploadSaving = false;
    }
  }
</script>

<section
  class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
>
  <p class="text-body-sm font-bold">
    {m.testcases_uploadZip()}
    <HelpTooltip text={m.testcases_zipFormatHelp()} />
  </p>
  <p class="mt-1 text-caption text-muted-foreground">
    {m.testcases_uploadZipHint()}
  </p>

  <div
    class="mt-3 rounded-lg border border-dashed border-border-subtle bg-[color:var(--color-panel)] px-4 py-3"
  >
    <div class="flex flex-wrap items-end gap-3">
      <div class="grid gap-1">
        <span class="text-caption text-muted-foreground">
          {m.testcases_regex()}
          <HelpTooltip text={m.testcases_zipStructureHint()} />
        </span>
        <input
          class="{smallInputClassName} w-48"
          oninput={(e) => {
            regexPattern = (e.target as HTMLInputElement).value;
            reparse();
          }}
          placeholder="(\d\d)(\d\d)"
          value={regexPattern}
        />
      </div>
      <div class="grid gap-1">
        <span class="text-caption text-muted-foreground">{m.testcases_inputExtension()}</span>
        <input
          class="{smallInputClassName} w-16"
          oninput={(e) => {
            inExt = (e.target as HTMLInputElement).value;
            reparse();
          }}
          value={inExt}
        />
      </div>
      <div class="grid gap-1">
        <span class="text-caption text-muted-foreground">{m.testcases_outputExtension()}</span>
        <input
          class="{smallInputClassName} w-16"
          oninput={(e) => {
            outExt = (e.target as HTMLInputElement).value;
            reparse();
          }}
          value={outExt}
        />
      </div>
      <div class="grid gap-1">
        <span class="text-caption text-muted-foreground">
          {m.testcases_uploadZip()}
        </span>
        <input
          accept=".zip"
          class="text-caption file:mr-2 file:rounded-full file:border file:border-border file:bg-[color:var(--color-panel)] file:px-3 file:py-1.5 file:text-caption file:font-semibold hover:file:bg-accent"
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
          class="rounded-full bg-success/15 px-3 py-1.5 text-caption font-medium text-success"
        >
          {m.testcases_casesUploaded({
            fileName: zipFileName ?? "",
            count: parsedCases.length,
          })}
        </span>
        <span class="text-caption text-muted-foreground">
          {m.testcases_subtasksDetected({ count: subtasks.length })}
        </span>
        <span
          class="text-caption font-medium tabular-nums {totalPoints === 100
            ? 'text-success'
            : 'text-warning'}"
        >
          {totalPoints}/100 pts
        </span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-caption text-muted-foreground">{m.testcases_autoSplitInto()}</span>
        {#each [1, 2, 3, 4, 5] as n (n)}
          <button
            class="rounded-full border px-3 py-1 text-caption font-medium tabular-nums transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {subtasks.length ===
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
        <div class="flex items-center justify-end gap-2 text-body-sm">
          <span class="text-muted-foreground">{m.testcases_totalWeight()}:</span>
          <span
            class="font-bold tabular-nums {totalPoints === 100
              ? 'text-success'
              : 'text-warning'}"
          >
            {totalPoints}/100
          </span>
        </div>
        {#each subtasks as subtask, si (`subtask-${si}`)}
          <div
            class="rounded-lg border border-border-subtle bg-[color:var(--color-panel)] px-5 py-4 shadow-rest"
          >
            <div class="flex flex-wrap items-center gap-3">
              <label class="grid gap-1">
                <span class="text-caption font-medium text-muted-foreground"
                  >{m.testcases_subtaskLabel()}</span
                >
                <input
                  class="rounded-lg border border-border bg-[color:var(--color-panel)] px-3 py-2 text-body-sm font-semibold"
                  oninput={(e) =>
                    updateSubtask(si, { name: (e.target as HTMLInputElement).value })}
                  value={subtask.name}
                />
              </label>
              <label class="grid gap-1">
                <span class="text-caption font-medium text-muted-foreground"
                  >{m.testcases_subtaskWeight()}</span
                >
                <div class="flex items-center gap-1">
                  <input
                    class="w-20 rounded-lg border-2 border-primary/30 bg-[color:var(--color-panel)] px-2 py-2 text-body-sm font-bold text-primary tabular-nums"
                    min="0"
                    oninput={(e) =>
                      updateSubtask(si, {
                        points: Number((e.target as HTMLInputElement).value) || 0,
                      })}
                    type="number"
                    value={subtask.points}
                  />
                  <span class="text-caption text-muted-foreground">pts</span>
                </div>
              </label>
              <span
                class="mt-auto rounded-full bg-info/15 px-2.5 py-1 text-caption font-medium text-info tabular-nums"
              >
                {m.testcases_casesCount({ count: subtask.caseIndices.length })}
              </span>
              {#if subtasks.length > 1}
                <button
                  class="ml-auto mt-auto text-body-sm text-destructive transition-[opacity] duration-fast ease-out-soft hover:opacity-80"
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
        class="rounded-full bg-primary px-5 py-2.5 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
        onclick={uploadSubtasks}
        disabled={uploadSaving || subtasks.length === 0}
        type="button"
      >
        {uploadSaving
          ? m.testcases_saving()
          : m.testcases_uploadSubtasks({ count: subtasks.length })}
      </button>
    </div>
  {/if}
</section>
