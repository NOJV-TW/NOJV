<script lang="ts">
  import type { Language, SubmissionContext } from "@nojv/core";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { shortcuts } from "$lib/stores/shortcuts.svelte";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary,
  } from "$lib/types";
  import AdvancedModeWorkspace from "../advanced/AdvancedModeWorkspace.svelte";
  import MobileWorkspaceBlocker from "../layouts/MobileWorkspaceBlocker.svelte";
  import ProblemSwitcherDrawer from "../layouts/ProblemSwitcherDrawer.svelte";
  import ProblemWorkspace from "../layouts/ProblemWorkspace.svelte";

  export interface ProblemSolveSibling {
    id: string;
    letter: string;
    title: string;
    bestScore?: number | undefined;
    maxScore: number;
    isActive: boolean;
    href: string;
  }

  export interface ProblemSolveExamContext {
    examId: string;
    courseId: string;
    examTitle: string;
    countdownMs: number;
    ipAddress: string;
    userHandle: string;
  }

  interface Props {
    mode: "practice" | "exam";
    problem: ProblemDetail;
    submissions?: ProblemSubmissionEntry[];
    testcaseSets?: ProblemTestcaseSetSummary[];
    allowedLanguages?: Language[] | undefined;
    assessment?:
      | {
          assessmentId: string;
          courseId: string;
        }
      | undefined;
    endedKind?: "assignment" | "exam" | undefined;
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    canRejudge?: boolean;
    canViewEditorials?: boolean;
    postsEnabled?: boolean;
    contestId?: string | undefined;
    virtualContestId?: string | undefined;
    dailyAttempts?: { used: number; max: number | null; resetMinuteOfDay: number } | undefined;
    siblingProblems?: ProblemSolveSibling[] | undefined;
    examContext?: ProblemSolveExamContext | undefined;
  }

  let {
    mode,
    problem,
    submissions = [],
    testcaseSets = [],
    allowedLanguages,
    assessment,
    endedKind,
    backLink,
    canRejudge = false,
    canViewEditorials = false,
    postsEnabled = false,
    contestId,
    virtualContestId,
    dailyAttempts,
    siblingProblems,
    examContext,
  }: Props = $props();

  let submissionContext = $derived.by<SubmissionContext>(() => {
    if (mode === "exam") {
      if (!examContext) throw new Error("Exam solve view requires an exam context");
      return { type: "exam", examId: examContext.examId };
    }

    const configuredContexts = [assessment, contestId, virtualContestId].filter(Boolean);
    if (configuredContexts.length > 1) {
      throw new Error("Problem solve view received multiple submission contexts");
    }
    if (assessment) return { type: "assignment", ...assessment };
    if (contestId) return { type: "contest", contestId };
    if (virtualContestId) return { type: "virtual", participationId: virtualContestId };
    return { type: "practice" };
  });
  let workspaceIdentity = $derived(JSON.stringify([problem.id, submissionContext]));

  let endedNotice = $derived(
    endedKind === "assignment"
      ? m.assignment_endedNotice()
      : endedKind === "exam"
        ? m.exam_endedNotice()
        : null,
  );

  let hasSiblings = $derived((siblingProblems?.length ?? 0) > 0);

  let solvedCount = $derived(
    siblingProblems?.filter((s) => s.bestScore !== undefined && s.bestScore >= s.maxScore)
      .length ?? 0,
  );

  $effect(() => {
    if (!hasSiblings || !siblingProblems) return;
    const sibs = siblingProblems;
    const activeIndex = sibs.findIndex((s) => s.isActive);
    const offs = [
      shortcuts.register({
        id: "problem-prev",
        keys: ["["],
        description: m.shortcut_prevProblem(),
        category: "navigation",
        handler: () => {
          const target = sibs[activeIndex - 1];
          if (target) void goto(target.href);
        },
      }),
      shortcuts.register({
        id: "problem-next",
        keys: ["]"],
        description: m.shortcut_nextProblem(),
        category: "navigation",
        handler: () => {
          const target = sibs[activeIndex + 1];
          if (target) void goto(target.href);
        },
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  });
</script>

<div class="lg:hidden">
  <MobileWorkspaceBlocker {problem} />
</div>

<div
  class="hidden h-full flex-col overflow-hidden rounded-xl border border-border-subtle shadow-rest lg:flex"
>
  {#if endedNotice}
    <div
      class="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-caption font-medium text-warning"
      role="status"
    >
      <span aria-hidden="true">⚠</span>
      <span>{endedNotice}</span>
    </div>
  {/if}
  <div class="relative flex min-h-0 flex-1">
    {#if hasSiblings && siblingProblems}
      <ProblemSwitcherDrawer siblings={siblingProblems} {solvedCount} />
    {/if}

    <div class="flex min-h-0 min-w-0 flex-1 {hasSiblings ? 'pl-6' : ''}">
      {#key workspaceIdentity}
        {#if problem.type === "special_env"}
          <AdvancedModeWorkspace
            context={submissionContext}
            {backLink}
            {canRejudge}
            {canViewEditorials}
            {postsEnabled}
            {dailyAttempts}
            initialSubmissions={submissions}
            {problem}
            requiredPaths={problem.advancedRequiredPaths ?? []}
            {testcaseSets}
          />
        {:else}
          <ProblemWorkspace
            context={submissionContext}
            {allowedLanguages}
            {backLink}
            {canRejudge}
            {canViewEditorials}
            {postsEnabled}
            {dailyAttempts}
            initialSubmissions={submissions}
            {problem}
            {testcaseSets}
          />
        {/if}
      {/key}
    </div>
  </div>
</div>
