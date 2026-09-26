<script lang="ts">
  import type { LatePenaltyRule, SubmissionContext } from "@nojv/core";
  import { untrack } from "svelte";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary,
  } from "$lib/types";
  import { m } from "$lib/paraglide/messages.js";
  import ProblemDescriptionPanel from "../left-panel/ProblemDescriptionPanel.svelte";
  import SubmissionHistoryPanel from "../left-panel/SubmissionHistoryPanel.svelte";
  import PostPanel from "../left-panel/PostPanel.svelte";
  import WorkspaceTimer from "./WorkspaceTimer.svelte";
  import BackLink from "$lib/components/primitives/layout/BackLink.svelte";

  type ProblemBackLinkType = "assignment" | "contest" | "exam" | "virtual" | "problems";

  export type ProblemWorkspaceTimer =
    | {
        type: "exam";
        examId: string;
        endsAt: string;
        dueAt: string | null;
        latePenalty: LatePenaltyRule | null;
      }
    | {
        type: "assignment";
        endsAt: string;
        dueAt: string | null;
        latePenalty: LatePenaltyRule | null;
      }
    | { type: "contest"; endsAt: string };

  export interface ProblemLeftPanelProps {
    context?: SubmissionContext | undefined;
    backLink?: { href: string; type: ProblemBackLinkType } | undefined;
    canRejudge?: boolean;
    canViewEditorials?: boolean;
    postsEnabled?: boolean;
    dailyAttempts?: { used: number; max: number | null; resetMinuteOfDay: number } | undefined;
    submissions?: ProblemSubmissionEntry[];
    newSubmissionCount?: number;
    historyRevision?: number;
    onShowLatest?: (() => void) | undefined;
    problem: ProblemDetail;
    testcaseSets?: ProblemTestcaseSetSummary[];
    allowedLanguages?: string[] | undefined;
    workspaceTimer?: ProblemWorkspaceTimer | undefined;
  }

  let {
    context,
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    postsEnabled = false,
    dailyAttempts,
    submissions = $bindable([]),
    newSubmissionCount = 0,
    historyRevision = 0,
    onShowLatest,
    problem,
    testcaseSets = [],
    allowedLanguages,
    workspaceTimer,
  }: ProblemLeftPanelProps = $props();

  type LeftTab = "description" | "editorials" | "discussions" | "submissions";

  let leftTab = $state<LeftTab>("description");
  let viewingId = $state<string | null>(null);

  let lastKnownHead = $state<string | null>(
    untrack(() => submissions[0]?.id ?? submissions[0]?.submittedAt ?? null),
  );
  $effect(() => {
    const headEntry = submissions[0];
    const head = headEntry?.id ?? headEntry?.submittedAt ?? null;
    if (head !== lastKnownHead) {
      lastKnownHead = head;
      if (head !== null) {
        leftTab = "submissions";
        viewingId = headEntry?.id ?? null;
      }
    }
  });

  let hasAc = $derived(
    canViewEditorials || submissions.some((s) => s.result?.verdict === "accepted"),
  );

  const uid = $props.id();

  let tabDefs = $derived<{ key: LeftTab; label: string }[]>([
    { key: "description", label: m.problemDetail_description() },
    { key: "submissions", label: m.problemDetail_submissions() },
    ...(postsEnabled
      ? [
          { key: "discussions" as LeftTab, label: m.posts_discussionsTitle() },
          { key: "editorials" as LeftTab, label: m.posts_editorialsTitle() },
        ]
      : []),
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
    <BackLink
      class="shrink-0 rounded-md px-2.5 py-1.5 text-caption transition-[color,background-color] hover:bg-muted"
      href={backLink.href}
      label={m.common_back()}
    />
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
      </button>
    {/each}
  </div>
  {#if workspaceTimer?.type === "contest"}
    <WorkspaceTimer timer={workspaceTimer} />
  {/if}
</div>

{#if workspaceTimer && workspaceTimer.type !== "contest"}
  <div class="border-b border-border-subtle px-3 py-2">
    <WorkspaceTimer timer={workspaceTimer} />
  </div>
{/if}

<div
  id={`${uid}-panel`}
  role="tabpanel"
  aria-labelledby={`${uid}-tab-${leftTab}`}
  tabindex="0"
  data-history-scroll
  class="flex-1 overflow-y-auto focus-visible:outline-none"
>
  {#if leftTab === "description"}
    <ProblemDescriptionPanel {problem} {testcaseSets} {allowedLanguages} {dailyAttempts} />
  {:else if leftTab === "submissions"}
    {#key historyRevision}
      <SubmissionHistoryPanel
        {newSubmissionCount}
        {onShowLatest}
        {context}
        problemId={problem.id}
        bind:submissions
        bind:viewingId
        {canRejudge}
        total={problem.totalScore}
      />
    {/key}
  {:else if postsEnabled && leftTab === "editorials"}
    <PostPanel problemId={problem.id} type="editorial" canView={hasAc} />
  {:else if postsEnabled && leftTab === "discussions"}
    <PostPanel problemId={problem.id} type="discussion" canView={true} />
  {/if}
</div>
