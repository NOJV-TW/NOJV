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
    /**
     * Server-computed flag controlling whether the "Rejudge this submission"
     * button is rendered in the submission detail view. The real gate lives
     * on `/api/submissions/[id]/rejudge`; this is progressive disclosure only.
     */
    canRejudge?: boolean;
    /**
     * Server-computed editorial visibility — true when the viewer has AC
     * OR has authored an editorial. The client `hasAc` derive only sees the
     * current submission list, so an author whose AC was overturned by a
     * rejudge needs this flag to keep editorial access.
     */
    canViewEditorials?: boolean;
    /**
     * Whether the Editorials tab is rendered at all. Only practice enables it;
     * assignment/contest/exam workspaces omit it to avoid an editorial spoiler
     * mid-event. Distinct from `canViewEditorials`, which gates content once the
     * tab is shown.
     */
    editorialsEnabled?: boolean;
    /** Assignment-only daily submission quota shown in the SpecialLabels strip.
     *  `max: null` means unlimited — the badge renders `{used} / ∞`. */
    dailyAttempts?: { used: number; max: number | null } | undefined;
    /**
     * Bindable submission history. Parents (the right-pane Editor / advanced
     * uploader) mutate this array to push freshly-completed submissions; the
     * left pane owns the rendering and the lazy source-code fetch effect.
     */
    submissions?: ProblemSubmissionEntry[];
    /** Initial active tab when the panel mounts. Parents pass the default and
     * then leave tab state alone — the panel auto-flips to "submissions" when
     * it detects a new entry at the head of `submissions`. */
    leftTab?: "description" | "editorials" | "submissions";
    /** Initial submission focus when the panel mounts. */
    viewingIndex?: number | null;
    problem: ProblemDetail;
    testcaseSets?: ProblemTestcaseSetSummary[];
    /** Unique DOM id suffix so two panels can coexist on the same page without colliding ids. */
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

  // Tab + focused-entry are panel-owned one-way state. Parents never read them
  // back, so we drop the $bindable round-trip and instead auto-flip when a new
  // submission lands at the head of `submissions` (see effect below). The
  // props seed the initial value only; untrack() makes the capture explicit.
  let leftTab = $state<"description" | "editorials" | "submissions">(
    untrack(() => initialLeftTab)
  );
  let viewingIndex = $state<number | null>(untrack(() => initialViewingIndex));

  // Detect a newly-prepended submission by watching the first entry's marker
  // (id when the server has assigned one, otherwise submittedAt). On mount we
  // seed the baseline so the initial render does NOT count as a new submit.
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

  // Editorial gate: a fresh AC in the live submission list OR the
  // server-computed flag (which also covers authors grandfathered past a
  // rejudge that overturned their AC).
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
