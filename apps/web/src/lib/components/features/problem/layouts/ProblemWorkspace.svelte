<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { page } from "$app/state";
  import {
    languageSchema,
    type Language,
    type SubmissionContext,
    type SubmissionResult,
  } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { draftContextFromSubmissionContext } from "$lib/stores/code-draft";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary,
  } from "$lib/types";
  import ProblemEditor from "../editors/Editor.svelte";
  import {
    DEFAULT_PANEL_WIDTH,
    clampPanelWidth,
    createDocumentMouseDrag,
    persistPanelWidth,
    readPanelWidth,
  } from "../editors/editor-bindings";
  import ProblemLeftPanel from "./ProblemLeftPanel.svelte";

  interface Props {
    allowedLanguages?: Language[] | undefined;
    context: SubmissionContext;
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    canRejudge?: boolean;
    canViewEditorials?: boolean;
    postsEnabled?: boolean;
    dailyAttempts?: { used: number; max: number | null; resetMinuteOfDay: number } | undefined;
    initialSubmissions?: ProblemSubmissionEntry[];
    problem: ProblemDetail;
    testcaseSets?: ProblemTestcaseSetSummary[];
  }

  let {
    allowedLanguages,
    context,
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    postsEnabled = false,
    dailyAttempts,
    initialSubmissions,
    problem,
    testcaseSets = [],
  }: Props = $props();

  let submissions = $state<ProblemSubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);

  let draftContext = $derived(draftContextFromSubmissionContext(context));

  const initialLanguage = (() => {
    const fromSubmission = languageSchema.safeParse(
      untrack(() => initialSubmissions)?.[0]?.language,
    );
    if (fromSubmission.success) return fromSubmission.data;
    const fromCookie = languageSchema.safeParse(untrack(() => page.data.editorLanguage));
    return fromCookie.success ? fromCookie.data : undefined;
  })();

  function handleSubmissionDispatched(submissionId: string, language: string) {
    submissions = [
      {
        id: submissionId,
        language,
        submittedAt: new Date().toISOString(),
        context: context.type,
      },
      ...submissions,
    ].slice(0, 50);
  }

  function handleSubmissionComplete(
    submissionId: string,
    result: SubmissionResult,
    language: string,
    sourceCode: string,
  ) {
    const index = submissions.findIndex((s) => s.id === submissionId);
    if (index >= 0) {
      submissions[index] = { ...submissions[index]!, result, sourceCode };
      return;
    }
    submissions = [
      {
        id: submissionId,
        language,
        result,
        sourceCode,
        submittedAt: new Date().toISOString(),
        context: context.type,
      },
      ...submissions,
    ].slice(0, 50);
  }

  let leftPanelWidth = $state(DEFAULT_PANEL_WIDTH);
  let isResizing = $state(false);

  onMount(() => {
    leftPanelWidth = readPanelWidth();
  });

  function setWidth(width: number) {
    leftPanelWidth = clampPanelWidth(width);
  }

  function resetWidth() {
    setWidth(DEFAULT_PANEL_WIDTH);
    persistPanelWidth(DEFAULT_PANEL_WIDTH);
  }

  let resizeContainer: HTMLElement | null = null;
  const resizeDrag = createDocumentMouseDrag({
    cursor: "col-resize",
    onStart: () => (isResizing = true),
    onMove: (event) => {
      if (!resizeContainer) return;
      const rect = resizeContainer.getBoundingClientRect();
      setWidth(((event.clientX - rect.left) / rect.width) * 100);
    },
    onEnd: () => {
      isResizing = false;
      persistPanelWidth(leftPanelWidth);
      resizeContainer = null;
    },
  });

  function startResize(event: MouseEvent) {
    resizeContainer = (event.currentTarget as HTMLElement).parentElement;
    if (resizeContainer) resizeDrag.start(event);
  }

  onDestroy(resizeDrag.dispose);
</script>

<div
  class="flex w-full shrink-0 flex-col overflow-hidden bg-card"
  style="width: {leftPanelWidth}%"
>
  <ProblemLeftPanel
    {backLink}
    {canRejudge}
    {canViewEditorials}
    {postsEnabled}
    {dailyAttempts}
    bind:submissions
    {problem}
    {testcaseSets}
    {allowedLanguages}
  />
</div>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->

<div
  class="group hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center outline-none lg:flex"
  role="separator"
  aria-orientation="vertical"
  aria-label={m.common_resizePanels()}
  title={m.common_resizePanelsHint()}
  tabindex="0"
  onmousedown={startResize}
  ondblclick={resetWidth}
  onkeydown={(e) => {
    if (e.key === "ArrowLeft") {
      setWidth(leftPanelWidth - 2);
      persistPanelWidth(leftPanelWidth);
    }
    if (e.key === "ArrowRight") {
      setWidth(leftPanelWidth + 2);
      persistPanelWidth(leftPanelWidth);
    }
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
  <ProblemEditor
    {allowedLanguages}
    {context}
    {draftContext}
    {initialLanguage}
    onSubmissionDispatched={handleSubmissionDispatched}
    onSubmissionComplete={handleSubmissionComplete}
    attemptsExhausted={!!dailyAttempts &&
      dailyAttempts.max != null &&
      dailyAttempts.used >= dailyAttempts.max}
    {problem}
  />
</div>
