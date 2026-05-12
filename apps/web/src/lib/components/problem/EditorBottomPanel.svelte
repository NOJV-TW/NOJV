<script lang="ts">
  import type { SubmissionResult } from "@nojv/core";
  import { Trash2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatVerdictLabel, verdictColor } from "$lib/types";

  interface RunCase {
    input: string;
    expectedOutput: string;
  }

  interface Props {
    /**
     * Bindable: the parent (Editor.svelte) owns this array so the Run
     * handler can read exactly what the student typed into the panel.
     * The parent seeds it from `problem.samples` on first render.
     */
    runCases: RunCase[];
    /**
     * When `true`, the Testcase tab hides its editing UI and shows a
     * read-only notice instead. Used for `special_env` problems where
     * the TA image owns the testcase format and a generic stdin panel
     * would be misleading.
     */
    readOnly?: boolean;
    /** Active tab — bound so the parent can flip to "result" when a run starts. */
    tab: "testcase" | "result";
    /** Final verdict from the most recent Run invocation, if any. */
    runResult: SubmissionResult | null;
    /** Transient status string while a run is in flight (e.g. "running"). */
    runStatus: string | null;
    /** Surfaced error message from the last Run / Submit failure. */
    runError: string | null;
    /** Fires when the user clicks a tab. */
    ontabchange: (tab: "testcase" | "result") => void;
    /**
     * When true, render the draft status chip + clear button in the tab
     * strip. Caller (Editor.svelte) passes false in workspace mode where
     * the draft key has no path dimension.
     */
    draftEnabled?: boolean;
    /** Current language buffer differs from the last persisted draft. */
    isDirty?: boolean;
    /** Epoch ms of the last successful save for the current language. */
    lastSavedAt?: number | null;
    /** Fires when the user clicks the trash icon. */
    onClearDraft?: (() => void) | undefined;
  }

  let {
    runCases = $bindable(),
    readOnly = false,
    tab,
    runResult,
    runStatus,
    runError,
    ontabchange,
    draftEnabled = false,
    isDirty = false,
    lastSavedAt = null,
    onClearDraft
  }: Props = $props();

  function formatSavedTime(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  let selectedCase = $state(0);
  let selectedResultCase = $state(0);

  // Reset the result-case cursor whenever a new run lands so the result
  // tab opens on the first case.
  $effect(() => {
    void runResult;
    selectedResultCase = 0;
  });

  let runVerdictLabel = $derived(
    runResult ? formatVerdictLabel(runResult.verdict) : undefined
  );
</script>

<div class="flex h-full flex-col">
  <div class="flex items-center border-b border-border-subtle px-2">
    <button
      class="px-3 py-2 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {tab === 'testcase'
        ? 'border-b-2 border-foreground text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => ontabchange("testcase")}
      type="button"
    >
      {m.editor_testcase()}
    </button>
    <button
      class="px-3 py-2 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {tab === 'result'
        ? 'border-b-2 border-foreground text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => ontabchange("result")}
      type="button"
    >
      {m.editor_testResult()}
    </button>
    {#if draftEnabled}
      <div class="ml-auto flex items-center gap-2 pr-2">
        {#if lastSavedAt == null && !isDirty}
          <span class="text-caption text-muted-foreground/70">{m.draft_none()}</span>
        {:else if isDirty}
          <span class="flex items-center gap-1 text-caption font-medium text-amber-500">
            <span class="inline-block size-1.5 animate-pulse rounded-full bg-amber-500"></span>
            {m.draft_unsaved()}
          </span>
        {:else if lastSavedAt != null}
          <span class="text-caption text-muted-foreground tabular-nums">
            {m.draft_lastSavedAt({ time: formatSavedTime(lastSavedAt) })}
          </span>
        {/if}
        {#if lastSavedAt != null || isDirty}
          <button
            aria-label={m.draft_clearAction()}
            class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
            onclick={() => onClearDraft?.()}
            title={m.draft_clearAction()}
            type="button"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-3">
    {#if tab === "testcase"}
      {#if readOnly}
        <p class="py-4 text-body-sm text-muted-foreground">
          {m.editor_runCasesDisabled()}
        </p>
      {:else}
      <div>
        <div class="flex items-center gap-1">
          {#each runCases as _, index (`tab-${index}`)}
            <button
              class="group relative rounded-md px-3 py-1 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {selectedCase ===
              index
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (selectedCase = index)}
              type="button"
            >
              Case {index + 1}
              {#if runCases.length > 1}
                <span
                  class="ml-1.5 hidden text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-destructive group-hover:inline"
                  role="button"
                  tabindex="-1"
                  onclick={(e: MouseEvent) => {
                    e.stopPropagation();
                    runCases = runCases.filter((_, i) => i !== index);
                    selectedCase = Math.min(selectedCase, runCases.length - 1);
                  }}
                  onkeydown={() => {}}
                >
                  &times;
                </span>
              {/if}
            </button>
          {/each}
          <button
            class="rounded-md px-2 py-1 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
            onclick={() => {
              runCases = [...runCases, { input: "", expectedOutput: "" }];
              selectedCase = runCases.length - 1;
            }}
            type="button"
          >
            +
          </button>
        </div>

        <div class="mt-3">
          <p class="text-caption text-muted-foreground">{m.editor_input()}</p>
          <textarea
            class="mt-1 w-full rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground outline-none transition-[box-shadow] duration-fast ease-out-soft focus:ring-1 focus:ring-border"
            oninput={(e) => {
              const val = (e.target as HTMLTextAreaElement).value;
              runCases = runCases.map((tc, i) =>
                i === selectedCase ? { ...tc, input: val } : tc
              );
            }}
            rows={3}
            value={runCases[selectedCase]?.input ?? ""}
          ></textarea>
        </div>

        <div class="mt-3">
          <p class="text-caption text-muted-foreground">{m.editor_expectLabel()}</p>
          <textarea
            class="mt-1 w-full rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-muted-foreground outline-none transition-[box-shadow] duration-fast ease-out-soft focus:ring-1 focus:ring-border"
            oninput={(e) => {
              const val = (e.target as HTMLTextAreaElement).value;
              runCases = runCases.map((tc, i) =>
                i === selectedCase ? { ...tc, expectedOutput: val } : tc
              );
            }}
            rows={2}
            value={runCases[selectedCase]?.expectedOutput ?? ""}
          ></textarea>
        </div>
      </div>
      {/if}
    {:else}
      <div>
        {#if runResult}
          <div>
            <div class="flex items-baseline gap-3">
              <span
                class="text-body-lg font-semibold {verdictColor[runResult.verdict] ??
                  'text-foreground'}"
              >
                {runVerdictLabel}
              </span>
              {#if runResult.runtimeMs > 0}
                <span class="text-caption text-muted-foreground tabular-nums">
                  Runtime: {String(runResult.runtimeMs)} ms
                </span>
              {/if}
            </div>

            {#if runResult.caseResults && runResult.caseResults.length > 0}
              <div class="mt-3 flex items-center gap-1">
                {#each runResult.caseResults as cr, index (`rc-${index}`)}
                  <button
                    class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {selectedResultCase ===
                    index
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'}"
                    onclick={() => (selectedResultCase = index)}
                    type="button"
                  >
                    <span class={cr.passed ? "text-success" : "text-destructive"}>
                      {cr.passed ? "\u2714" : "\u2718"}
                    </span>
                    Case {index + 1}
                  </button>
                {/each}
              </div>

              <div class="mt-3 space-y-3">
                {#if runCases[selectedResultCase]}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">{m.editor_input()}</p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{runCases[selectedResultCase]!.input}</pre>
                  </div>
                {/if}

                {#if runResult.caseResults[selectedResultCase]}
                  {@const caseData = runResult.caseResults[selectedResultCase]!}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">{m.editor_outputLabel()}</p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{caseData.stdout || "(empty)"}</pre>
                  </div>
                  {#if caseData.stderr}
                    <div>
                      <p class="text-caption font-medium text-destructive">Stderr</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{caseData.stderr}</pre>
                    </div>
                  {/if}
                {/if}

                {#if runCases[selectedResultCase]?.expectedOutput}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {m.editor_expectLabel()}
                    </p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{runCases[selectedResultCase]!.expectedOutput}</pre>
                  </div>
                {/if}
              </div>
            {:else if runResult.feedback}
              <p class="mt-2 text-body-sm leading-6 text-muted-foreground">
                {runResult.feedback}
              </p>
            {/if}
          </div>
        {:else if runStatus}
          <div class="flex items-center gap-2 py-4">
            <div
              class="size-4 animate-spin rounded-full border-2 border-border border-t-foreground"
            ></div>
            <span class="text-body-sm text-muted-foreground">{runStatus}</span>
          </div>
        {:else if runError}
          <div class="rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive">
            {runError}
          </div>
        {:else}
          <p class="py-4 text-body-sm text-muted-foreground">{m.editor_runFirst()}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
