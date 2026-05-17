<script lang="ts">
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary
  } from "$lib/types";
  import AdvancedModeWorkspace from "../advanced/AdvancedModeWorkspace.svelte";
  import MobileWorkspaceBlocker from "../layouts/MobileWorkspaceBlocker.svelte";
  import ProblemSwitcherDrawer from "../layouts/ProblemSwitcherDrawer.svelte";
  import ProblemWorkspace from "../layouts/ProblemWorkspace.svelte";

  export interface ProblemSolveSibling {
    id: string;
    /** Display letter, e.g. "A", "B", "C" — assigned by the loader. */
    letter: string;
    title: string;
    /** Best score the current user has achieved on this sibling. */
    bestScore?: number | undefined;
    maxScore: number;
    /** Whether this row is the problem currently being solved. */
    isActive: boolean;
    /** Where clicking the row should navigate. */
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
    // `mode` is a UI hint ONLY — it MUST NOT be used as a security boundary; the loader owns all data scoping.
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
    /** Whether the viewer may rejudge submissions in this context. */
    canRejudge?: boolean;
    contestId?: string | undefined;
    /** Virtual-contest re-run id — tags submissions for the personal scoreboard. */
    virtualContestId?: string | undefined;
    /** Assignment-only daily submission quota shown in the problem header. */
    dailyAttempts?: { used: number; max: number | null } | undefined;
    /** Siblings in the same contest/exam/assignment. Renders a float drawer. */
    siblingProblems?: ProblemSolveSibling[] | undefined;
    /** Exam-only context, consumed by the route-level page chrome. */
    examContext?: ProblemSolveExamContext | undefined;
  }

  let {
    mode: _mode,
    problem,
    submissions = [],
    testcaseSets = [],
    allowedLanguages,
    assessment,
    endedKind,
    backLink,
    canRejudge = false,
    contestId,
    virtualContestId,
    dailyAttempts,
    siblingProblems,
    examContext: _examContext
  }: Props = $props();

  let endedNotice = $derived(
    endedKind === "assignment"
      ? m.assignment_endedNotice()
      : endedKind === "exam"
        ? m.exam_endedNotice()
        : null
  );

  let hasSiblings = $derived((siblingProblems?.length ?? 0) > 0);

  let solvedCount = $derived(
    siblingProblems?.filter(
      (s) => s.bestScore !== undefined && s.bestScore >= s.maxScore
    ).length ?? 0
  );
</script>

<!-- Mobile (< md): the Monaco editor + submit form are hidden behind a
     blocker. Statement remains accessible via the blocker's fullscreen
     viewer. Server-side IP/page-lock checks are unchanged. -->
<div class="md:hidden">
  <MobileWorkspaceBlocker {problem} />
</div>

<div
  class="hidden h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-border shadow-rest md:flex"
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

    <!-- Main workspace. When siblings exist, leave 24px room on the left for the always-visible trigger bar. -->
    <div class="flex min-h-0 min-w-0 flex-1 {hasSiblings ? 'pl-6' : ''}">
      {#if problem.type === "special_env"}
        <AdvancedModeWorkspace
          {allowedLanguages}
          {assessment}
          {backLink}
          {canRejudge}
          {contestId}
          {virtualContestId}
          {dailyAttempts}
          initialSubmissions={submissions}
          {problem}
          requiredPaths={problem.advancedRequiredPaths ?? []}
          {testcaseSets}
        />
      {:else}
        <ProblemWorkspace
          {allowedLanguages}
          {assessment}
          {backLink}
          {canRejudge}
          {contestId}
          {virtualContestId}
          {dailyAttempts}
          initialSubmissions={submissions}
          {problem}
          {testcaseSets}
        />
      {/if}
    </div>
  </div>
</div>
