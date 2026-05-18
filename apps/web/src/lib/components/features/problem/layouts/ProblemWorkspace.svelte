<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { type Language, type SubmissionResult } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { inferDraftContext } from "$lib/stores/code-draft";
  import type { ProblemDetail, ProblemSubmissionEntry, ProblemTestcaseSetSummary } from "$lib/types";
  import ProblemEditor from "../editors/Editor.svelte";
  import ProblemLeftPanel from "./ProblemLeftPanel.svelte";

  interface Props {
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
    testcaseSets?: ProblemTestcaseSetSummary[];
  }

  let {
    allowedLanguages,
    assessment,
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    contestId,
    virtualContestId,
    dailyAttempts,
    initialSubmissions,
    problem,
    testcaseSets = []
  }: Props = $props();

  let submissions = $state<ProblemSubmissionEntry[]>(untrack(() => initialSubmissions) ?? []);

  let draftContext = $derived(inferDraftContext(page.route.id, page.params));

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
  />
</div>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- Resize handle (desktop only) — role="separator" carries keyboard intent.
     Hit area is 8px wide; the visible line is 1px and stays transparent
     until hover / focus / active drag, à la VS Code. -->
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
  <ProblemEditor
    {allowedLanguages}
    {assessment}
    {contestId}
    {virtualContestId}
    {draftContext}
    onSubmissionComplete={handleSubmissionComplete}
    {problem}
  />
</div>

