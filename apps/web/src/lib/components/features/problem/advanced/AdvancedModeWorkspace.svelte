<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import {
    apiErrorSchema,
    submissionDispatchResponseSchema,
    submissionOperationSchema,
    submissionResultSchema,
    type Language,
    type SubmissionResult
  } from "@nojv/core";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary
  } from "$lib/types";
  import ProblemLeftPanel from "../layouts/ProblemLeftPanel.svelte";
  import AdvancedUploader, { type StagedFile } from "./AdvancedUploader.svelte";
  import AdvancedFileManager from "./AdvancedFileManager.svelte";

  interface Props {
    // `allowedLanguages` is irrelevant for advanced mode (TA image owns
    // execution) but accepted for prop-shape parity with ProblemWorkspace.
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentId: string;
      courseId: string;
    } | undefined;
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    canRejudge?: boolean;
    /** Server-computed editorial visibility (AC or authored an editorial). */
    canViewEditorials?: boolean;
    contestId?: string | undefined;
    virtualContestId?: string | undefined;
    dailyAttempts?: { used: number; max: number | null } | undefined;
    initialSubmissions?: ProblemSubmissionEntry[];
    problem: ProblemDetail;
    /** TA-configured paths the student's ZIP must contain. Empty array = no constraint. */
    requiredPaths?: string[];
    testcaseSets?: ProblemTestcaseSetSummary[];
  }

  let {
    assessment,
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    contestId,
    virtualContestId,
    dailyAttempts,
    initialSubmissions,
    problem,
    requiredPaths = [],
    testcaseSets = []
  }: Props = $props();

  let submissions = $state<ProblemSubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);

  function handleSubmissionComplete(
    result: SubmissionResult,
    language: string,
    sourceCode: string
  ) {
    submissions = [
      {
        language,
        result,
        sourceCode,
        submittedAt: new Date().toISOString()
      },
      ...submissions
    ].slice(0, 50);
    // ProblemLeftPanel auto-flips to the submissions tab when it sees a new
    // head entry in `submissions`.
  }

  let leftPanelWidth = $state(42);
  let isResizing = $state(false);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      leftPanelWidth = Math.max(20, Math.min(80, pct));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      isResizing = false;
    };

    isResizing = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  let staged = $state<StagedFile | null>(null);
  let stagingError = $state<string | null>(null);
  let isSubmitting = $state(false);
  let submitError = $state<string | null>(null);

  let pollAbortController: AbortController | null = null;
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    pollAbortController?.abort();
  });

  function clearStaged() {
    staged = null;
    stagingError = null;
    submitError = null;
  }

  async function handleSubmit() {
    if (!staged || isSubmitting) return;
    isSubmitting = true;
    submitError = null;

    pollAbortController = new AbortController();
    const { signal } = pollAbortController;

    // Advanced mode ignores `language`/`sourceCode` at the worker boundary; placeholders satisfy the wire schema.
    const placeholderLanguage: Language = "cpp";
    const placeholderSource = "// advanced-mode upload";

    const body = {
      assessment,
      contestId,
      virtualContestId,
      language: placeholderLanguage,
      mode: contestId
        ? "contest"
        : virtualContestId
          ? "virtual"
          : assessment
            ? "assignment"
            : "practice",
      problemId: problem.id,
      sampleOnly: false,
      sourceCode: placeholderSource,
      sourceFiles: staged.sourceFiles
    };

    try {
      const response = await fetch("/api/submissions", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        method: "POST",
        signal
      });

      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json());
        throw new Error(parsed.success ? parsed.data.message : "Submission failed.");
      }

      const dispatch = submissionDispatchResponseSchema.parse(await response.json());
      const startedAt = Date.now();
      let pollDelay = 500;

      while (Date.now() - startedAt < 30_000) {
        if (destroyed) return;

        const poll = await fetch(dispatch.pollUrl, { cache: "no-store", signal });

        if (!poll.ok) {
          const parsed = apiErrorSchema.safeParse(await poll.json());
          throw new Error(parsed.success ? parsed.data.message : "Polling failed.");
        }

        const operation = submissionOperationSchema.parse(await poll.json());

        if (operation.result) {
          const result = submissionResultSchema.parse(operation.result);
          const previewSource = staged.sourceFiles
            .map((f) => `// --- ${f.path} ---\n${f.content}`)
            .join("\n\n");
          handleSubmissionComplete(result, placeholderLanguage, previewSource);
          staged = null;
          return;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, pollDelay);
        });
        pollDelay = Math.min(pollDelay * 1.5, 3000);
      }

      throw new Error("Submission polling timed out.");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      submitError = err instanceof Error ? err.message : "Submission failed.";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div
  class="flex w-full shrink-0 flex-col overflow-hidden bg-card"
  style="width: {leftPanelWidth}%"
>
  <ProblemLeftPanel
    {backLink}
    {canRejudge}
    {canViewEditorials}
    {dailyAttempts}
    bind:submissions
    {problem}
    {testcaseSets}
    editorialFormIdSuffix="adv"
  />
</div>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="group hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center outline-none lg:flex"
  role="separator"
  aria-orientation="vertical"
  aria-label={m.common_resizePanels()}
  tabindex="0"
  onmousedown={startResize}
  onkeydown={(e) => {
    if (e.key === "ArrowLeft") leftPanelWidth = Math.max(20, leftPanelWidth - 2);
    if (e.key === "ArrowRight") leftPanelWidth = Math.min(80, leftPanelWidth + 2);
  }}
>
  <span
    aria-hidden="true"
    class="w-px transition-colors duration-fast {isResizing
      ? 'bg-primary'
      : 'bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary/60'}"
  ></span>
</div>

<div class="hidden flex-1 flex-col overflow-hidden lg:flex">
  <div
    class="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-[color:var(--color-panel)]"
  >
    <div
      class="flex h-11 items-center justify-between border-b border-border-subtle bg-muted/40 px-3"
    >
      <div class="flex items-center gap-3">
        <span class="text-caption font-semibold text-foreground/70">&lt;/&gt;</span>
        <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
          {m.advancedMode_badge()}
        </span>
      </div>
      {#if contestId}
        <span
          class="rounded-full bg-warning/15 px-2.5 py-0.5 text-caption font-medium text-warning"
        >
          {m.editor_contestMode()}
        </span>
      {:else if assessment}
        <span class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info">
          {m.editor_assignmentMode()}
        </span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <p class="text-body-sm leading-6 text-muted-foreground">
        {m.advancedMode_uploadInstructions()}
      </p>
      <AdvancedUploader
        inputId={`advanced-upload-${problem.id}`}
        bind:staged
        {requiredPaths}
        onStagingError={(msg) => {
          stagingError = msg;
          submitError = null;
        }}
      />

      {#if stagingError}
        <div
          class="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive"
          data-testid="advanced-staging-error"
        >
          {stagingError}
        </div>
      {/if}

      {#if submitError}
        <div class="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive">
          {submitError}
        </div>
      {/if}
    </div>

    <AdvancedFileManager
      {staged}
      {isSubmitting}
      onClear={clearStaged}
      onSubmit={() => void handleSubmit()}
    />
  </div>
</div>
