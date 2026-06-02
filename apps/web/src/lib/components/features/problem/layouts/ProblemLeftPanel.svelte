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
    canViewEditorials || submissions.some((s) => s.result?.verdict === "accepted")
  );

  const uid = $props.id();

  type LeftTab = "description" | "editorials" | "submissions";
  let tabDefs = $derived<{ key: LeftTab; label: string }[]>([
    { key: "description", label: m.problemDetail_description() },
    { key: "submissions", label: m.problemDetail_submissions() },
    ...(editorialsEnabled ? [{ key: "editorials" as LeftTab, label: m.editorials_title() }] : [])
  ]);

  function onTabKeydown(e: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const keys = tabDefs.map((t) => t.key);
    const cur = keys.indexOf(leftTab);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? keys.length - 1
          : e.key === "ArrowLeft"
            ? (cur - 1 + keys.length) % keys.length
            : (cur + 1) % keys.length;
    const nextKey = keys[next];
    if (!nextKey) return;
    leftTab = nextKey;
    document.getElementById(`${uid}-tab-${nextKey}`)?.focus();
  }
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
  <div role="tablist" aria-label={m.problemDetail_panelTabsLabel()} class="flex items-center">
    {#each tabDefs as t (t.key)}
      <button
        id={`${uid}-tab-${t.key}`}
        role="tab"
        aria-selected={leftTab === t.key}
        aria-controls={`${uid}-panel`}
        tabindex={leftTab === t.key ? 0 : -1}
        class="px-3 py-1.5 text-caption font-medium transition-[color,border-color] duration-fast ease-out-soft {leftTab ===
        t.key
          ? 'border-b-2 border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (leftTab = t.key)}
        onkeydown={onTabKeydown}
        type="button"
      >
        {t.label}
        {#if t.key === "submissions" && submissions.length > 0}
          <span class="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-micro tabular-nums">
            {submissions.length}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<div
  id={`${uid}-panel`}
  role="tabpanel"
  aria-labelledby={`${uid}-tab-${leftTab}`}
  tabindex="0"
  class="flex-1 overflow-y-auto focus-visible:outline-none"
>
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
