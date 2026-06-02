<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { page } from "$app/state";
  import { languageSchema, type Language, type SubmissionResult } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inferDraftContext } from "$lib/stores/code-draft";
  import type { ProblemDetail, ProblemSubmissionEntry, ProblemTestcaseSetSummary } from "$lib/types";
  import ProblemEditor from "../editors/Editor.svelte";
  import {
    DEFAULT_PANEL_WIDTH,
    clampPanelWidth,
    persistPanelWidth,
    readPanelWidth
  } from "../editors/editor-bindings";
  import ProblemLeftPanel from "./ProblemLeftPanel.svelte";

  interface Props {
    allowedLanguages?: Language[] | undefined;
    assessment?: {
      assessmentId: string;
      courseId: string;
    } | undefined;
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    canRejudge?: boolean;
    canViewEditorials?: boolean;
    editorialsEnabled?: boolean;
    contestId?: string | undefined;
    virtualContestId?: string | undefined;
    dailyAttempts?: { used: number; max: number | null } | undefined;
    initialSubmissions?: ProblemSubmissionEntry[];
    problem: ProblemDetail;
    testcaseSets?: ProblemTestcaseSetSummary[];
  }

  let {
    allowedLanguages,
    assessment,
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    editorialsEnabled = false,
    contestId,
    virtualContestId,
    dailyAttempts,
    initialSubmissions,
    problem,
    testcaseSets = []
  }: Props = $props();

  let submissions = $state<ProblemSubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);

  let draftContext = $derived(inferDraftContext(page.route.id, page.params));

  const initialLanguage = (() => {
    const fromSubmission = languageSchema.safeParse(
      untrack(() => initialSubmissions)?.[0]?.language
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
        context: draftContext.kind
      },
      ...submissions
    ].slice(0, 50);
  }

  function handleSubmissionComplete(
    submissionId: string,
    result: SubmissionResult,
    language: string,
    sourceCode: string
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
        context: draftContext.kind
      },
      ...submissions
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

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      setWidth(((ev.clientX - rect.left) / rect.width) * 100);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      isResizing = false;
      persistPanelWidth(leftPanelWidth);
    };

    isResizing = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
    {editorialsEnabled}
    {dailyAttempts}
    bind:submissions
    {problem}
    {testcaseSets}
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
    {assessment}
    {contestId}
    {virtualContestId}
    {draftContext}
    {initialLanguage}
    onSubmissionDispatched={handleSubmissionDispatched}
    onSubmissionComplete={handleSubmissionComplete}
    {problem}
  />
</div>

