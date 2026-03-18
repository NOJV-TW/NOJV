<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import * as Select from "$lib/components/ui/select";

  let { data } = $props();

  let matrix = $derived(data.matrix);
  let assessments = $derived(data.assessments);
  let selectedAssessment = $derived(data.selectedAssessment);

  function onAssessmentChange(value: string | undefined) {
    const url = new URL($page.url);
    if (value && value !== "__all__") {
      url.searchParams.set("assessment", value);
    } else {
      url.searchParams.delete("assessment");
    }
    goto(url.toString(), { replaceState: true });
  }

  function cellClass(score: { bestScore: number; bestVerdict: string } | undefined): string {
    if (!score) return "";
    if (score.bestVerdict === "accepted") return "bg-green-100 dark:bg-green-950/40";
    if (score.bestScore > 0) return "bg-yellow-100 dark:bg-yellow-950/40";
    return "bg-red-100 dark:bg-red-950/40";
  }

  function verdictIcon(score: { bestVerdict: string } | undefined): string {
    if (!score) return "\u2014";
    if (score.bestVerdict === "accepted") return "\u2713";
    return "\u2717";
  }

  function verdictLabel(verdict: string): string {
    switch (verdict) {
      case "accepted":
        return "AC";
      case "wrong_answer":
        return "WA";
      case "time_limit_exceeded":
        return "TLE";
      case "memory_limit_exceeded":
        return "MLE";
      case "runtime_error":
        return "RE";
      case "compile_error":
        return "CE";
      default:
        return verdict.toUpperCase();
    }
  }

  function acPercent(problemId: string): string {
    const stats = matrix.problemStats[problemId];
    if (!stats || stats.totalStudents === 0) return "0%";
    return `${Math.round((stats.acCount / stats.totalStudents) * 100)}%`;
  }
</script>

<section
  class="rounded-[2rem] border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 backdrop-blur-sm"
>
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">Student Progress</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {matrix.students.length} students, {matrix.problems.length} problems
      </p>
    </div>

    {#if assessments.length > 0}
      <div class="flex items-center gap-2">
        <Select.Root
          type="single"
          value={selectedAssessment ?? "__all__"}
          onValueChange={onAssessmentChange}
        >
          <Select.Trigger class="w-[220px]">
            {#if selectedAssessment}
              {assessments.find((a) => a.slug === selectedAssessment)?.title ?? "All"}
            {:else}
              All assessments
            {/if}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__" label="All assessments">All assessments</Select.Item>
            {#each assessments as assessment (assessment.slug)}
              <Select.Item value={assessment.slug} label={assessment.title}>
                <span class="inline-flex items-center gap-2">
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                  >
                    assignment
                  </span>
                  {assessment.title}
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>

        {#if selectedAssessment}
          <a
            href="/courses/{data.courseSlug}/manage/progress/export?assessment={selectedAssessment}"
            download="progress-{selectedAssessment}.csv"
            class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {m.progress_exportCsv()}
          </a>
        {/if}
      </div>
    {/if}
  </div>

  {#if matrix.problems.length === 0}
    <div class="mt-8 text-center text-muted-foreground">
      {#if selectedAssessment}
        No problems found for this assessment.
      {:else}
        No problems linked to this course yet.
      {/if}
    </div>
  {:else if matrix.students.length === 0}
    <div class="mt-8 text-center text-muted-foreground">No students enrolled in this course.</div>
  {:else}
    <!-- Stats bar -->
    <div class="mt-6 flex flex-wrap gap-3">
      {#each matrix.problems as problem (problem.problemId)}
        {@const pct = acPercent(problem.problemId)}
        <div
          class="rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
        >
          <span class="font-medium">{problem.title}</span>
          <span class="ml-2 text-muted-foreground">({pct} AC)</span>
        </div>
      {/each}
    </div>

    <!-- Matrix table -->
    <div class="mt-6 overflow-x-auto rounded-xl border border-border">
      <table class="w-full min-w-[600px] border-collapse text-sm">
        <thead>
          <tr class="border-b border-border bg-[color:var(--color-panel)]">
            <th
              class="sticky left-0 z-10 bg-[color:var(--color-panel)] px-4 py-3 text-left font-medium text-muted-foreground"
            >
              Student
            </th>
            {#each matrix.problems as problem (problem.problemId)}
              <th class="px-4 py-3 text-center font-medium text-muted-foreground">
                <div class="truncate max-w-[120px]" title={problem.title}>{problem.title}</div>
                <div class="text-xs font-normal">{acPercent(problem.problemId)} AC</div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix.students as student (student.userId)}
            <tr class="border-b border-border last:border-b-0 hover:bg-muted/50">
              <td
                class="sticky left-0 z-10 bg-[color:var(--color-panel-strong)] px-4 py-2.5 font-medium"
              >
                <div class="truncate max-w-[160px]" title={student.name}>
                  {student.username}
                </div>
              </td>
              {#each matrix.problems as problem (problem.problemId)}
                {@const score = matrix.scores[`${student.userId}:${problem.problemId}`]}
                <td class="px-4 py-2.5 text-center {cellClass(score)}">
                  {#if score}
                    <div class="flex flex-col items-center gap-0.5">
                      <span
                        class="text-base {score.bestVerdict === 'accepted'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'}"
                      >
                        {verdictIcon(score)}
                      </span>
                      <span class="text-xs text-muted-foreground">
                        {verdictLabel(score.bestVerdict)}
                        ({score.bestScore})
                      </span>
                    </div>
                  {:else}
                    <span class="text-muted-foreground">&mdash;</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
