<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { MAX_RUN_CASES, type JudgeType, type SubmissionRunCase } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import type { TestRunResult } from "$lib/types";
  import { formatVerdictLabel, verdictTone } from "$lib/utils/verdict-style";
  import { formatJudgeOutput } from "$lib/utils/judge-output";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";

  interface Props {
    runCases: SubmissionRunCase[];
    isReadOnly?: boolean;
    judgeType?: JudgeType;
    interactionFormat?: string | undefined;
    testDisabledReason?: string | null | undefined;
    judgeProgramDiagnostics?: string | null | undefined;
    tab: "testcase" | "result";
    runResult: TestRunResult | null;
    runSource?: "local" | null;
    runStatus: string | null;
    runError: string | null;
    ontabchange: (tab: "testcase" | "result") => void;
  }

  let {
    runCases = $bindable(),
    isReadOnly = false,
    judgeType,
    interactionFormat = "",
    testDisabledReason = null,
    judgeProgramDiagnostics = null,
    tab,
    runResult,
    runSource = null,
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

  let interactive = $derived(judgeType === "interactive");
  let caseInputLabel = $derived(
    interactive ? m.problemDetail_interactorInput() : m.editor_input(),
  );
  let executedOnly = $derived(
    !!runResult?.caseResults?.length &&
      runResult.caseResults.every((caseResult) => caseResult.executionOnly),
  );
  let selectedCaseResult = $derived(runResult?.caseResults?.[selectedResultCase]);
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
          {#if interactive && interactionFormat}
            <div class="mb-3">
              <p class="text-caption font-medium text-muted-foreground">
                {m.problemDetail_interactionFormat()}
              </p>
              <div class="mt-1 text-body-sm leading-relaxed text-foreground">
                <MarkdownRenderer content={interactionFormat} />
              </div>
            </div>
          {/if}
          <div class="flex items-center gap-1" data-tour="problem-samples">
            {#each runCases as _, index (`tab-${index}`)}
              <div
                class="group inline-flex items-center gap-1 rounded-full border border-border-subtle px-1 py-0.5 transition-[background-color,border-color] duration-fast ease-out-soft {selectedCase ===
                index
                  ? 'border-primary/35 bg-muted text-foreground'
                  : 'text-muted-foreground'}"
              >
                <button
                  class="inline-flex min-h-7 items-center justify-center rounded-full px-3 py-1 text-caption font-medium transition-[color] duration-fast ease-out-soft hover:text-foreground"
                  onclick={() => (selectedCase = index)}
                  type="button"
                >
                  {m.editor_case({ index: index + 1 })}
                </button>
                {#if runCases.length > 1}
                  <button
                    class="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-transparent text-muted-foreground transition-[color,border-color] duration-fast ease-out-soft hover:border-destructive/40 hover:bg-transparent hover:text-destructive"
                    type="button"
                    aria-label={m.editor_removeCase({ index: index + 1 })}
                    title={m.editor_removeCase({ index: index + 1 })}
                    onclick={() => {
                      runCases = runCases.filter((_, i) => i !== index);
                      selectedCase = Math.min(selectedCase, runCases.length - 1);
                    }}
                  >
                    <X aria-hidden="true" class="size-3.5" />
                  </button>
                {/if}
              </div>
            {/each}
            <button
              class="inline-flex size-7 items-center justify-center rounded bg-transparent text-muted-foreground transition-[color] duration-fast ease-out-soft hover:bg-transparent hover:text-foreground"
              aria-label={m.editor_testcase()}
              title={m.editor_testcase()}
              disabled={runCases.length >= MAX_RUN_CASES}
              onclick={() => {
                runCases = [...runCases, { input: "" }];
                selectedCase = runCases.length - 1;
              }}
              type="button"
            >
              <Plus aria-hidden="true" class="size-4" />
            </button>
          </div>

          <div class="mt-3">
            <p class="text-caption text-muted-foreground">{caseInputLabel}</p>
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

          {#if interactive}
            <p class="mt-3 text-caption text-muted-foreground">
              {m.editor_interactiveTestNote()}
            </p>
          {:else if judgeType === "checker"}
            <p class="mt-3 text-caption text-muted-foreground">
              {m.editor_checkerCasesNote()}
            </p>
          {:else}
            <div class="mt-3">
              <label class="flex items-center gap-2 text-caption text-muted-foreground">
                <input
                  type="checkbox"
                  checked={runCases[selectedCase]?.expectedOutput !== undefined}
                  onchange={(event) => {
                    const checked = event.currentTarget.checked;
                    runCases = runCases.map((tc, i) =>
                      i !== selectedCase
                        ? tc
                        : checked
                          ? { ...tc, expectedOutput: "" }
                          : { input: tc.input },
                    );
                  }}
                />
                {m.editor_compareOutput()}
              </label>
              <textarea
                aria-label={m.editor_expectLabel()}
                disabled={runCases[selectedCase]?.expectedOutput === undefined}
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
                class="inline-block text-body-lg font-semibold motion-safe:animate-[verdict-pop_320ms_var(--ease-spring)_both] {executedOnly
                  ? 'text-foreground'
                  : verdictTone(runResult.verdict)}"
              >
                {executedOnly ? m.editor_executed() : formatVerdictLabel(runResult.verdict)}
              </span>
              <Badge variant="muted" size="xs">{m.editor_samplesOnly()}</Badge>
              {#if runResult.runtimeMs > 0}
                <span class="text-caption text-muted-foreground tabular-nums">
                  {runSource === "local"
                    ? m.editor_localRuntime()
                    : m.submissionDetail_runtime()}: {String(runResult.runtimeMs)} ms
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
                    {#if cr.executionOnly}
                      <span class="text-muted-foreground" title={m.editor_executed()}>
                        {"\u25CB"}
                      </span>
                    {:else}
                      <span class={cr.verdict === "AC" ? "text-success" : "text-destructive"}>
                        {cr.verdict === "AC" ? "\u2714" : "\u2718"}
                      </span>
                    {/if}
                    {m.editor_case({ index: index + 1 })}
                  </button>
                {/each}
              </div>

              <div class="mt-3 space-y-3">
                {#if selectedCaseResult?.executionOnly}
                  <p class="text-caption text-muted-foreground">{m.editor_executedNote()}</p>
                {:else if selectedCaseResult?.judged && selectedCaseResult.verdict === "SE"}
                  <p class="text-caption text-muted-foreground">
                    {m.editor_judgeSystemError()}
                  </p>
                {/if}
                {#if selectedCaseResult?.teamMessage}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {m.editor_judgeFeedback()}
                    </p>
                    <p class="mt-1 whitespace-pre-wrap text-body-sm text-foreground">
                      {selectedCaseResult.teamMessage}
                    </p>
                  </div>
                {/if}
                {#if runCases[selectedResultCase]}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {caseInputLabel}
                    </p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{runCases[
                        selectedResultCase
                      ]!.input}</pre>
                  </div>
                {/if}

                {#if runResult.caseResults[selectedResultCase]}
                  {@const caseData = runResult.caseResults[selectedResultCase]!}
                  {#if !interactive}
                    <div>
                      <p class="text-caption font-medium text-muted-foreground">
                        {m.editor_outputLabel()}
                      </p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{caseData.stdout ||
                          m.common_emptyOutput()}</pre>
                    </div>
                  {/if}
                  {#if caseData.transcript}
                    <div class="@container">
                      <p class="text-caption font-medium text-muted-foreground">
                        {m.editor_transcript()}
                      </p>
                      <div class="mt-1 grid gap-2 @md:grid-cols-2">
                        <div class="min-w-0">
                          <p class="text-micro text-muted-foreground">
                            {m.editor_transcriptFromInteractor()}
                          </p>
                          <pre
                            class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{caseData
                              .transcript.toContestant || m.common_emptyOutput()}</pre>
                        </div>
                        <div class="min-w-0">
                          <p class="text-micro text-muted-foreground">
                            {m.editor_transcriptFromProgram()}
                          </p>
                          <pre
                            class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{caseData
                              .transcript.toInteractor || m.common_emptyOutput()}</pre>
                        </div>
                      </div>
                    </div>
                  {/if}
                  {#if caseData.stderr}
                    <div>
                      <p class="text-caption font-medium text-destructive">
                        {m.submissionDetail_stderr()}
                      </p>
                      <pre
                        class="mt-1 overflow-x-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{formatJudgeOutput(
                          caseData.stderr,
                        )}</pre>
                    </div>
                  {/if}
                {/if}

                {#if judgeType !== "checker" && runCases[selectedResultCase]?.expectedOutput !== undefined}
                  <div>
                    <p class="text-caption font-medium text-muted-foreground">
                      {m.editor_expectLabel()}
                    </p>
                    <pre
                      class="mt-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-body-sm text-foreground">{runCases[
                        selectedResultCase
                      ]!.expectedOutput || m.common_emptyOutput()}</pre>
                  </div>
                {/if}
              </div>
            {:else if runResult.feedback}
              {#if ["compile_error", "runtime_error", "system_error"].includes(runResult.verdict)}
                <pre
                  class="mt-3 max-h-64 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{formatJudgeOutput(
                    runResult.feedback,
                  )}</pre>
              {:else}
                <p class="mt-2 text-body-sm leading-6 text-muted-foreground">
                  {runResult.feedback}
                </p>
              {/if}
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
          <p class="py-4 text-body-sm text-muted-foreground">
            {testDisabledReason ?? m.editor_runFirst()}
          </p>
          {#if judgeProgramDiagnostics}
            <pre
              class="max-h-64 overflow-auto rounded-md bg-destructive/10 px-3 py-2 font-mono text-body-sm text-destructive">{formatJudgeOutput(
                judgeProgramDiagnostics,
              )}</pre>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>
