<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";

  export type ProblemsTabProblem = courseDomain.AssignmentDetailProblem;
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils.js";

  interface Props {
    problems: ProblemsTabProblem[];
    assessmentId: string;
    class?: string;
  }

  let { problems, assessmentId, class: className }: Props = $props();

  function difficultyClass(difficulty: "easy" | "medium" | "hard"): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    return "text-destructive";
  }
</script>

<section data-slot="assignment-problems-tab" class={cn("space-y-3", className)}>
  <div class="mb-4 flex items-baseline justify-between gap-4">
    <h2 class="font-display text-title font-medium leading-tight">
      {m.assignmentDetail_teacherProblemsHeading()}
    </h2>
    <span class="text-caption text-muted-foreground">
      {m.assignmentDetail_teacherProblemsHint()}
    </span>
  </div>

  <div class="grid gap-3">
    {#each problems as problem (problem.problemId)}
      <a
        href={`/assignments/${assessmentId}/problems/${problem.problemId}`}
        class="group grid grid-cols-[auto_1fr_auto] items-center gap-5 rounded-lg border border-border bg-[color:var(--color-panel)] px-5 py-4 no-underline transition-[transform,border-color,box-shadow] duration-fast ease-out-soft hover:translate-x-[2px] hover:border-border-strong hover:shadow-rest"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted font-display text-title-sm font-medium text-muted-foreground"
        >
          {problem.letter}
        </div>
        <div class="min-w-0">
          <h4 class="truncate text-body-lg font-semibold text-foreground">
            {problem.title}
          </h4>
          <div class="mt-1 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
            <span class={cn("font-semibold uppercase tracking-[0.08em]", difficultyClass(problem.difficulty))}>
              {problem.difficulty}
            </span>
            <span>{problem.points} pts</span>
            <span class="font-mono opacity-75">{problem.problemId}</span>
          </div>
        </div>
        <div class="text-right text-caption text-muted-foreground tabular-nums leading-snug">
          <!-- TODO(course-overview): class stats (solved / total / avg) pending the
               per-assessment submission aggregation query. See Task 3.2. -->
          <span class="block font-display text-title-sm font-medium text-foreground">—</span>
          {m.assignmentDetail_teacherProblemsClassPending()}
        </div>
      </a>
    {/each}
  </div>
</section>
