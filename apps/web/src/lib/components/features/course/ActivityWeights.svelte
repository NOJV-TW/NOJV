<script lang="ts">
  import type { ActivityProblem } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import { equalActivityWeights, rescaleActivityWeights } from "$lib/utils/activity-weights";

  let {
    totalPoints = $bindable(),
    problems,
    titles = {},
    onchange,
  }: {
    totalPoints: number;
    problems: ActivityProblem[];
    titles?: Record<string, string>;
    onchange: (rows: ActivityProblem[]) => void;
  } = $props();
  const allocated = $derived(problems.reduce((sum, p) => sum + p.points, 0));
  const complete = $derived(Math.abs(allocated - totalPoints) < 0.00000001);

  let totalEditBase: { totalPoints: number; problems: ActivityProblem[] } | undefined;

  function changeTotal(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(next) || next <= 0) return;
    const base = totalEditBase ?? { totalPoints, problems };
    const rows = rescaleActivityWeights(base.problems, base.totalPoints, next);
    totalPoints = next;
    onchange(rows);
  }
  function changeWeight(id: string, event: Event) {
    const percent = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    onchange(
      problems.map((p) =>
        p.problemId === id
          ? { ...p, points: Number(((totalPoints * percent) / 100).toFixed(8)) }
          : p,
      ),
    );
  }
</script>

<div class="space-y-3 rounded-lg border border-border p-4" data-slot="activity-weights">
  <div class="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] items-start gap-2">
    <h3 class="col-span-3 text-body-sm font-medium sm:col-span-1">
      {m.activityWeights_heading()}
    </h3>
    <div class="col-start-2 space-y-1">
      <span class="block w-24 text-center text-body-sm font-medium"
        >{m.activityWeights_percentage()}</span
      >
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="w-24 px-2"
        disabled={!problems.length}
        onclick={() => onchange(equalActivityWeights(problems, totalPoints))}
        >{m.activityWeights_equal()}</Button
      >
    </div>
    <label class="justify-self-end space-y-1 text-body-sm font-medium">
      <span class="block w-24 text-center">{m.activityWeights_total()}</span>
      <input
        class="h-9 w-24 rounded-md border border-border bg-background px-2 py-1 text-right tabular-nums"
        aria-label={m.activityWeights_total()}
        type="number"
        min="0.01"
        max="1000000000"
        step="0.01"
        value={totalPoints}
        onfocus={() => (totalEditBase = { totalPoints, problems })}
        onblur={() => (totalEditBase = undefined)}
        oninput={changeTotal}
        required
      />
    </label>
  </div>
  {#each problems as problem, index (problem.problemId)}
    <div class="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] items-center gap-2">
      <label class="contents text-body-sm">
        <span class="col-span-3 min-w-0 truncate sm:col-span-1"
          >{index + 1}. {titles[problem.problemId] ?? problem.problemId}</span
        >
        <span class="col-start-2 flex items-center gap-1">
          <input
            aria-label={m.activityWeights_weight({
              title: titles[problem.problemId] ?? problem.problemId,
            })}
            class="h-9 w-24 shrink-0 rounded-md border border-border bg-background px-2 py-1 text-right tabular-nums"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={Number(((problem.points / totalPoints) * 100).toFixed(2))}
            oninput={(event) => changeWeight(problem.problemId, event)}
          />%
        </span>
      </label>
      <span class="text-right text-body-sm tabular-nums text-muted-foreground"
        >{m.activityWeights_points({ points: Number(problem.points.toFixed(4)) })}</span
      >
    </div>
  {/each}
  <p class="text-body-sm tabular-nums" class:text-destructive={!complete} role="status">
    {m.activityWeights_sum({ percent: Number(((allocated / totalPoints) * 100).toFixed(2)) })}
  </p>
  {#if !complete}<p class="text-caption text-muted-foreground">
      {m.activityWeights_incomplete()}
    </p>{/if}
</div>
