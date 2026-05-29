<script lang="ts">
  import { untrack } from "svelte";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary
  } from "$lib/types";
  import { m } from "$lib/paraglide/messages.js";
  import ProblemDescriptionPanel from "../left-panel/ProblemDescriptionPanel.svelte";
  import SubmissionHistoryPanel from "../left-panel/SubmissionHistoryPanel.svelte";
  import EditorialListPanel from "../left-panel/EditorialListPanel.svelte";

  export interface ProblemLeftPanelProps {
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    canRejudge?: boolean;
    canViewEditorials?: boolean;
    editorialsEnabled?: boolean;
    dailyAttempts?: { used: number; max: number | null } | undefined;
    submissions?: ProblemSubmissionEntry[];
    leftTab?: "description" | "editorials" | "submissions";
    viewingIndex?: number | null;
    problem: ProblemDetail;
    testcaseSets?: ProblemTestcaseSetSummary[];
    editorialFormIdSuffix?: string;
  }

  let {
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    editorialsEnabled = false,
    dailyAttempts,
    submissions = $bindable([]),
    leftTab: initialLeftTab = "description",
    viewingIndex: initialViewingIndex = null,
    problem,
    testcaseSets = [],
    editorialFormIdSuffix = ""
  }: ProblemLeftPanelProps = $props();

  let leftTab = $state<"description" | "editorials" | "submissions">(
    untrack(() => initialLeftTab)
  );
  let viewingIndex = $state<number | null>(untrack(() => initialViewingIndex));

  let lastKnownHead = $state<string | null>(
    untrack(() => submissions[0]?.id ?? submissions[0]?.submittedAt ?? null)
  );
  $effect(() => {
    const head = submissions[0]?.id ?? submissions[0]?.submittedAt ?? null;
    if (head !== lastKnownHead) {
      lastKnownHead = head;
      if (head !== null) {
        leftTab = "submissions";
        viewingIndex = 0;
      }
    }
  });

  let hasAc = $derived(
    canViewEditorials || submissions.some((s) => s.result.verdict === "accepted")
  );
</script>

<div class="flex h-9 items-center border-b border-border-subtle px-2">
  {#if backLink}
    <a
      class="px-3 py-1.5 text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
      href={backLink.href}
    >
      &larr; {backLink.type === 'contest' ? m.problemDetail_backToContest() : m.problemDetail_backToAssignment()}
    </a>
  {/if}
  <button
    class="px-3 py-1.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab === 'description'
      ? 'border-b-2 border-primary text-foreground'
      : 'text-muted-foreground hover:text-foreground'}"
    onclick={() => (leftTab = "description")}
    type="button"
  >
    {m.problemDetail_description()}
  </button>
  <button
    class="px-3 py-1.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab === 'submissions'
      ? 'border-b-2 border-primary text-foreground'
      : 'text-muted-foreground hover:text-foreground'}"
    onclick={() => (leftTab = "submissions")}
    type="button"
  >
    {m.problemDetail_submissions()}
    {#if submissions.length > 0}
      <span class="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-micro tabular-nums">
        {submissions.length}
      </span>
    {/if}
  </button>
  {#if editorialsEnabled}
    <button
      class="px-3 py-1.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab === 'editorials'
        ? 'border-b-2 border-primary text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => (leftTab = "editorials")}
      type="button"
    >
      {m.editorials_title()}
    </button>
  {/if}
</div>

<div class="flex-1 overflow-y-auto">
  {#if leftTab === "description"}
    <ProblemDescriptionPanel {problem} {testcaseSets} {dailyAttempts} />
  {:else if leftTab === "submissions"}
    <SubmissionHistoryPanel bind:submissions bind:viewingIndex {canRejudge} />
  {:else if editorialsEnabled && leftTab === "editorials"}
    <EditorialListPanel
      problemId={problem.id}
      {hasAc}
      active={leftTab === "editorials"}
      formIdSuffix={editorialFormIdSuffix}
    />
  {/if}
</div>
