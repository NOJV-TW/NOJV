<script lang="ts">
  import type { JudgeType, SubmissionResult } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { formatVerdictLabel, verdictTone } from "$lib/utils/verdict-style";
  import { Badge } from "$lib/components/primitives/ui/badge";

  interface RunCase {
    input: string;
    expectedOutput: string;
  }

  interface Props {
    runCases: RunCase[];
    isReadOnly?: boolean;
    judgeType?: JudgeType;
    tab: "testcase" | "result";
    runResult: SubmissionResult | null;
    runStatus: string | null;
    runError: string | null;
    ontabchange: (tab: "testcase" | "result") => void;
  }

  let {
    runCases = $bindable(),
    isReadOnly = false,
    judgeType,
    tab,
    runResult,
    runStatus,
    runError,
    ontabchange,
  }: Props = $props();

  const uid = $props.id();

  function onBottomTabKeydown(e: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const target: "testcase" | "result" =
      e.key === "Home"
        ? "testcase"
        : e.key === "End"
          ? "result"
          : tab === "testcase"
            ? "result"
            : "testcase";
    ontabchange(target);
    document.getElementById(`${uid}-btab-${target}`)?.focus();
  }

  let selectedCase = $state(0);
  let selectedResultCase = $state(0);

  $effect(() => {
    void runResult;
    selectedResultCase = 0;
  });

  let runVerdictLabel = $derived(runResult ? formatVerdictLabel(runResult.verdict) : undefined);
</script>

<div class="flex h-full flex-col">
  <div class="flex items-center border-b border-border-subtle px-2">
    <div role="tablist" aria-label={m.editor_bottomTabsLabel()} class="flex items-center">
      <button
        id={`${uid}-btab-testcase`}
        role="tab"
        aria-selected={tab === "testcase"}
        aria-controls={`${uid}-bpanel`}
        tabindex={tab === "testcase" ? 0 : -1}
        class="px-3 py-2 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {tab ===
        'testcase'
          ? 'border-b-2 border-foreground text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => ontabchange("testcase")}
        onkeydown={onBottomTabKeydown}
        type="button"
      >
        {m.editor_testcase()}
      </button>
      <button
        id={`${uid}-btab-result`}
        role="tab"
        aria-selected={tab === "result"}
        aria-controls={`${uid}-bpanel`}
        tabindex={tab === "result" ? 0 : -1}
        class="px-3 py-2 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {tab ===
        'result'
          ? 'border-b-2 border-foreground text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => ontabchange("result")}
        onkeydown={onBottomTabKeydown}
        type="button"
      >
        {m.editor_testResult()}
      </button>
    </div>
  </div>

  <div
    id={`${uid}-bpanel`}
    role="tabpanel"
    aria-labelledby={`${uid}-btab-${tab}`}
    class="flex-1 overflow-y-auto px-4 py-3 focus-visible:outline-none"
  >
    {#if tab === "testcase"}
      {#if isReadOnly}
        <p class="py-4 text-body-sm text-muted-foreground">
          {m.editor_runCasesDisabled()}
        </p>
      {:else}
        <div>
          <div class="flex items-center gap-1">
            {#each runCases as _, index (`tab-${index}`)}
              <div
                class="group flex items-center rounded-md transition-[background-color] duration-fast ease-out-soft {selectedCase ===
                index
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground'}"
              >
                <button
                  class="rounded-md px-3 py-1 text-caption font-medium transition-[color] duration-fast ease-out-soft hover:text-foreground"
                  onclick={() => (selectedCase = index)}
                  type="button"
                >
                  {m.editor_case({ index: index + 1 })}
                </button>
                {#if runCases.length > 1}
                  <button
                    class="mr-1 rounded text-muted-foreground opacity-0 transition-[color,opacity] duration-fast ease-out-soft hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    type="button"
                    aria-label={m.editor_removeCase({ index: index + 1 })}
                    onclick={() => {
                      runCases = runCases.filter((_, i) => i !== index);
                      selectedCase = Math.min(selectedCase, runCases.length - 1);
                    }}
                  >
                    &times;
                  </button>
                {/if}
              </div>
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
                  i === selectedCase ? { ...tc, input: val } : tc,
                );
              }}
              rows={3}
              value={runCases[selectedCase]?.input ?? ""}></textarea>
          </div>

          {#if judgeType === "interactive"}
            <p class="mt-3 text-caption text-muted-foreground">
              {m.editor_expectInteractiveNote()}
            </p>
          {:else}
            <div class="mt-3">
              <p class="text-caption text-muted-foreground">{m.editor_expectLabel()}</p>
              <textarea
                class="mt-1 w-full rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground outline-none transition-[box-shadow] duration-fast ease-out-soft focus:ring-1 focus:ring-border"
                oninput={(e) => {
                  const val = (e.target as HTMLTextAreaElement).value;
                  runCases = runCases.map((tc, i) =>
                    i === selectedCase ? { ...tc, expectedOutput: val } : tc,
                  );
                }}
                rows={2}
                value={runCases[selectedCase]?.expectedOutput ?? ""}></textarea>
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <div role="status" aria-live="polite">
        {#if runResult}
          <div>
            <div class="flex items-baseline gap-3">
              <span
                class="inline-block text-body-lg font-semibold motion-safe:animate-[verdict-pop_320ms_var(--ease-spring)_both] {verdictTone(
                  runResult.verdict,
                )}"
              >
                {runVerdictLabel}
              </span>
              <Badge variant="muted" size="xs">{m.editor_samplesOnly()}</Badge>
              {#if runResult.runtimeMs > 0}
                <span class="text-caption text-muted-foreground tabular-nums">
                  {m.submissionDetail_runtime()}: {String(runResult.runtimeMs)} ms
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
                    <span class={cr.verdict === "AC" ? "text-success" : "text-destructive"}>
                      {cr.verdict === "AC" ? "\u2714" : "\u2718"}
                    </span>
                    {m.editor_case({ index: index + 1 })}
                  </button>
                {/each}
              </div>

              <div class="mt-3 space-y-3">
                {#if runCases[selectedResultCase]}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {m.editor_input()}
                    </p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{runCases[
                        selectedResultCase
                      ]!.input}</pre>
                  </div>
                {/if}

                {#if runResult.caseResults[selectedResultCase]}
                  {@const caseData = runResult.caseResults[selectedResultCase]!}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {m.editor_outputLabel()}
                    </p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{caseData.stdout ||
                        m.common_emptyOutput()}</pre>
                  </div>
                  {#if caseData.stderr}
                    <div>
                      <p class="text-caption font-medium text-destructive">
                        {m.submissionDetail_stderr()}
                      </p>
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
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{runCases[
                        selectedResultCase
                      ]!.expectedOutput}</pre>
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
