<script lang="ts">
  import { untrack } from "svelte";
  import type { SubmissionResult } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { formatVerdictLabel, verdictColor } from "$lib/types";

  interface Testcase {
    input: string;
    expectedOutput: string;
  }

  interface Props {
    /** Seed cases pulled from `problem.samples`; the panel owns mutations after mount. */
    initialTestcases: Testcase[];
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
  }

  let {
    initialTestcases,
    tab,
    runResult,
    runStatus,
    runError,
    ontabchange
  }: Props = $props();

  let testcases = $state<Testcase[]>(untrack(() => [...initialTestcases]));
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
  <!-- Bottom tabs -->
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
  </div>

  <!-- Bottom content -->
  <div class="flex-1 overflow-y-auto px-4 py-3">
    {#if tab === "testcase"}
      <div>
        <div class="flex items-center gap-1">
          {#each testcases as _, index (`tab-${index}`)}
            <button
              class="group relative rounded-md px-3 py-1 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {selectedCase ===
              index
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (selectedCase = index)}
              type="button"
            >
              Case {index + 1}
              {#if testcases.length > 1}
                <span
                  class="ml-1.5 hidden text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-destructive group-hover:inline"
                  role="button"
                  tabindex="-1"
                  onclick={(e: MouseEvent) => {
                    e.stopPropagation();
                    testcases = testcases.filter((_, i) => i !== index);
                    selectedCase = Math.min(selectedCase, testcases.length - 1);
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
              testcases = [...testcases, { input: "", expectedOutput: "" }];
              selectedCase = testcases.length - 1;
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
              testcases = testcases.map((tc, i) =>
                i === selectedCase ? { ...tc, input: val } : tc
              );
            }}
            rows={3}
            value={testcases[selectedCase]?.input ?? ""}
          ></textarea>
        </div>

        <div class="mt-3">
          <p class="text-caption text-muted-foreground">{m.editor_output()}</p>
          <textarea
            class="mt-1 w-full rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-muted-foreground outline-none transition-[box-shadow] duration-fast ease-out-soft focus:ring-1 focus:ring-border"
            oninput={(e) => {
              const val = (e.target as HTMLTextAreaElement).value;
              testcases = testcases.map((tc, i) =>
                i === selectedCase ? { ...tc, expectedOutput: val } : tc
              );
            }}
            rows={2}
            value={testcases[selectedCase]?.expectedOutput ?? ""}
          ></textarea>
        </div>
      </div>
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
                    class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption font-medium transition-[background-color,color] duration-fast ease-out-soft {selectedResultCase ===
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
                {#if testcases[selectedResultCase]}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">{m.editor_input()}</p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{testcases[selectedResultCase]!.input}</pre>
                  </div>
                {/if}

                {#if runResult.caseResults[selectedResultCase]}
                  {@const caseData = runResult.caseResults[selectedResultCase]!}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">{m.editor_output()}</p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{caseData.stdout || "(empty)"}</pre>
                  </div>
                  {#if caseData.stderr}
                    <div>
                      <p class="text-caption font-medium text-destructive">Stderr</p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-lg bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{caseData.stderr}</pre>
                    </div>
                  {/if}
                {/if}

                {#if testcases[selectedResultCase]?.expectedOutput}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {m.editor_output()}
                    </p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{testcases[selectedResultCase]!.expectedOutput}</pre>
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
