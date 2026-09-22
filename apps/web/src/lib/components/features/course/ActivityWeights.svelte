<script lang="ts">
  import type { ActivityProblem } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";

  let {
    totalPoints = $bindable(),
    problems,
    titles = {},
    onchange,
    totalErrors,
  }: {
    totalErrors?: string[] | undefined;
    totalPoints: number;
    problems: ActivityProblem[];
    titles?: Record<string, string>;
    onchange: (rows: ActivityProblem[]) => void;
  } = $props();
  const id = $props.id();
  const errorId = `${id}-error`;
  const total = $derived(Number(problems.reduce((sum, p) => sum + p.points, 0).toFixed(4)));

  $effect(() => {
    if (problems.length) totalPoints = total;
  });

  function changePoints(problemId: string, event: Event) {
    const points = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(points) || points < 0) return;
    onchange(problems.map((p) => (p.problemId === problemId ? { ...p, points } : p)));
  }
</script>

<div class="space-y-3 rounded-lg border border-border p-4" data-slot="activity-weights">
  <h3 class="text-body-sm font-medium">{m.activityWeights_heading()}</h3>
  {#each problems as problem, index (problem.problemId)}
    <label class="flex items-center gap-2 text-body-sm">
      <span class="min-w-0 flex-1 truncate"
        >{index + 1}. {titles[problem.problemId] ?? problem.problemId}</span
      >
      <input
        aria-label={m.activityWeights_weight({
          title: titles[problem.problemId] ?? problem.problemId,
        })}
        aria-invalid={totalErrors?.length ? "true" : undefined}
        aria-describedby={totalErrors?.length ? errorId : undefined}
        class="h-9 w-24 shrink-0 rounded-md border border-border aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 bg-background px-2 py-1 text-right tabular-nums"
        type="number"
        min="0"
        max="1000000000"
        step="0.01"
        value={problem.points}
        oninput={(event) => changePoints(problem.problemId, event)}
      />
      <span class="w-6 shrink-0 text-muted-foreground">{m.activityWeights_points()}</span>
    </label>
  {/each}
  {#if totalErrors?.length}
    <p id={errorId} role="alert" class="text-caption text-destructive">
      {totalErrors.join(", ")}
    </p>
  {/if}
  <p class="text-right text-body-sm tabular-nums" role="status">
    {m.activityWeights_sum({ points: total })}
  </p>
</div>
