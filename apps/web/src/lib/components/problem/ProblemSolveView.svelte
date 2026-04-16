<script lang="ts">
  import type { Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import type {
    ProblemDetail,
    ProblemSubmissionEntry,
    ProblemTestcaseSetSummary
  } from "$lib/types";
  import AdvancedModeWorkspace from "./advanced/AdvancedModeWorkspace.svelte";
  import ProblemWorkspace from "./Workspace.svelte";

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
    backLink?: { href: string; type: "assignment" | "contest" } | undefined;
    contestId?: string | undefined;
    /** Exam-only left rail. Hidden in practice mode regardless of value. */
    siblingProblems?: ProblemSolveSibling[] | undefined;
    /** Exam-only context, consumed by the route-level page chrome. */
    examContext?: ProblemSolveExamContext | undefined;
  }

  let {
    mode,
    problem,
    submissions = [],
    testcaseSets = [],
    allowedLanguages,
    assessment,
    backLink,
    contestId,
    siblingProblems,
    examContext: _examContext
  }: Props = $props();

  let showSiblingRail = $derived(mode === "exam" && (siblingProblems?.length ?? 0) > 0);

  function siblingClass(sibling: ProblemSolveSibling): string {
    if (sibling.isActive) {
      return "border-primary bg-card shadow-rest";
    }
    if (sibling.bestScore !== undefined && sibling.bestScore >= sibling.maxScore) {
      return "border-transparent hover:border-success/30 hover:bg-success/5";
    }
    if (sibling.bestScore !== undefined && sibling.bestScore > 0) {
      return "border-transparent hover:border-destructive/30 hover:bg-destructive/5";
    }
    return "border-transparent hover:bg-muted";
  }

  function siblingLetterClass(sibling: ProblemSolveSibling): string {
    if (sibling.isActive) return "bg-primary text-primary-foreground";
    if (sibling.bestScore !== undefined && sibling.bestScore >= sibling.maxScore) {
      return "bg-success/15 text-success";
    }
    if (sibling.bestScore !== undefined && sibling.bestScore > 0) {
      return "bg-destructive/15 text-destructive";
    }
    return "bg-muted text-muted-foreground";
  }

  function siblingScoreClass(sibling: ProblemSolveSibling): string {
    if (sibling.bestScore === undefined) return "text-muted-foreground";
    if (sibling.bestScore >= sibling.maxScore) return "text-success";
    if (sibling.bestScore > 0) return "text-destructive";
    return "text-muted-foreground";
  }

  function formatSiblingScore(sibling: ProblemSolveSibling): string {
    if (sibling.bestScore === undefined) return "—";
    if (sibling.bestScore >= sibling.maxScore) return String(sibling.maxScore);
    return `${String(sibling.bestScore)}/${String(sibling.maxScore)}`;
  }

  let solvedCount = $derived(
    siblingProblems?.filter(
      (s) => s.bestScore !== undefined && s.bestScore >= s.maxScore
    ).length ?? 0
  );
</script>

<div
  class="flex h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border border-border shadow-rest"
>
  {#if showSiblingRail && siblingProblems}
    <!-- Exam-mode sibling problem navigator. Practice mode never renders this. -->
    <aside
      class="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-card/60 px-4 py-5 lg:flex"
    >
      <div
        class="flex items-center justify-between px-2 pb-3 text-caption font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <span>{m.exam_problemsHeader()}</span>
        <span class="font-mono tabular-nums normal-case tracking-normal">
          {solvedCount}/{siblingProblems.length}
        </span>
      </div>
      {#each siblingProblems as sibling (sibling.id)}
        <a
          class="mb-1 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md border px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-fast ease-out-soft {siblingClass(
            sibling
          )}"
          href={sibling.href}
          aria-current={sibling.isActive ? "page" : undefined}
        >
          <span
            class="flex size-6 items-center justify-center rounded-sm font-display text-caption font-medium {siblingLetterClass(
              sibling
            )}"
          >
            {sibling.letter}
          </span>
          <span class="truncate text-body-sm font-medium leading-tight text-foreground">
            {sibling.title}
          </span>
          <span class="font-mono text-caption tabular-nums {siblingScoreClass(sibling)}">
            {formatSiblingScore(sibling)}
          </span>
        </a>
      {/each}
    </aside>
  {/if}

  <!-- Main workspace — same dispatcher the practice page used before extraction. -->
  {#if problem.type === "special_env"}
    <AdvancedModeWorkspace
      {allowedLanguages}
      {assessment}
      {backLink}
      {contestId}
      initialSubmissions={submissions}
      {problem}
      {testcaseSets}
    />
  {:else}
    <ProblemWorkspace
      {allowedLanguages}
      {assessment}
      {backLink}
      {contestId}
      initialSubmissions={submissions}
      {problem}
      {testcaseSets}
    />
  {/if}
</div>
