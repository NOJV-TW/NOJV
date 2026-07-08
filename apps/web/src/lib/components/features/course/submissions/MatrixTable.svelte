<script lang="ts">
  import { cn } from "$lib/utils/css.js";
  import type {
    MatrixCell,
    MatrixProblemColumn,
    MatrixRow,
    MatrixViewLabels,
  } from "./MatrixView.svelte";

  interface Props {
    problems: MatrixProblemColumn[];
    rows: MatrixRow[];
    totalPoints: number;
    labels: MatrixViewLabels;
    viewHref?: ((userId: string) => string) | undefined;
    oncellclick?: ((userId: string, problemId: string) => void) | undefined;
  }

  let { problems, rows, totalPoints, labels, viewHref, oncellclick }: Props = $props();
</script>

{#snippet cellBody(cell: MatrixCell)}
  {#if cell.state === "empty"}
    <span>—</span>
  {:else}
    <span>{cell.score}</span>
    {#if cell.state === "ac"}
      <span class="ml-1 font-bold">✓</span>
    {/if}
    <span class="mt-0.5 block text-micro font-normal opacity-70">
      {labels.attempts({ count: cell.attempts })}
    </span>
  {/if}
  {#if cell.practiceAttempts > 0 && labels.practiceSummary}
    <span class="mt-1 block text-micro font-normal text-muted-foreground opacity-90">
      {labels.practiceSummary({
        score: cell.practiceScore ?? 0,
        count: cell.practiceAttempts,
      })}
    </span>
  {/if}
{/snippet}

<div class="overflow-x-auto rounded-md border border-border">
  <table class="w-full border-separate border-spacing-0 tabular-nums">
    <thead>
      <tr>
        <th
          class="sticky left-0 z-[3] border-b border-r border-border-subtle bg-muted px-5 py-3 text-left text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground"
          style="min-width: 200px"
        >
          {labels.student()}
        </th>
        {#each problems as problem (problem.problemId)}
          <th
            class="border-b border-r border-border-subtle bg-muted px-3 py-3 text-center text-caption font-semibold"
            style="min-width: 88px"
          >
            <span
              class="block text-title font-medium leading-none tracking-[-0.02em] text-foreground"
            >
              {problem.letter}
            </span>
            <span class="mt-1 block text-micro font-normal text-muted-foreground">
              {labels.maxPoints({ points: problem.points })}
            </span>
          </th>
        {/each}
        <th
          class="border-b border-r border-border-subtle bg-primary/8 px-3 py-3 text-center text-caption font-semibold text-primary"
          style="min-width: 110px"
        >
          {labels.total()}
        </th>
        {#if viewHref}
          <th
            class="border-b border-border-subtle bg-muted px-3 py-3 text-center text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground"
            style="min-width: 72px"
          >
          </th>
        {/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.userId)}
        <tr>
          <td
            class="sticky left-0 z-[1] border-b border-r border-border-subtle bg-background px-5 py-3 text-left before:absolute before:inset-0 before:-z-[1] before:bg-[color:var(--color-panel)] before:content-['']"
          >
            <div class="font-medium tracking-[-0.005em] text-foreground">{row.displayName}</div>
            {#if row.handle}
              <div class="mt-0.5 font-mono text-caption text-muted-foreground">
                {row.handle}
              </div>
            {/if}
          </td>
          {#each row.cells as cell (cell.problemId)}
            <td
              class={cn(
                "border-b border-r border-border-subtle text-center text-body-sm transition-[background-color,color] duration-normal ease-out-soft",
                !oncellclick && "px-3 py-3",
                cell.state === "ac" && "bg-success/15 font-semibold text-success",
                cell.state === "partial" && "bg-warning/12 text-warning",
                cell.state === "zero" && "bg-destructive/20 font-semibold text-destructive",
                cell.state === "empty" && "text-muted-foreground",
              )}
              style={cell.state === "empty"
                ? "background: repeating-linear-gradient(45deg, transparent, transparent 4px, var(--border-subtle) 4px, var(--border-subtle) 8px);"
                : ""}
            >
              {#if oncellclick}
                <button
                  type="button"
                  class="block h-full w-full cursor-pointer px-3 py-3 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-primary"
                  title={labels.gradeCellTitle?.()}
                  aria-label={labels.gradeCellTitle?.()}
                  onclick={() => oncellclick?.(row.userId, cell.problemId)}
                >
                  {@render cellBody(cell)}
                </button>
              {:else}
                {@render cellBody(cell)}
              {/if}
            </td>
          {/each}
          <td
            class="border-b border-r border-border-subtle bg-primary/5 px-3 py-3 text-center text-body-lg font-medium text-foreground"
          >
            {row.total}<span class="font-normal text-muted-foreground"> / </span>
            <span class="text-caption font-normal text-muted-foreground">
              {totalPoints}
            </span>
          </td>
          {#if viewHref}
            <td class="border-b border-border-subtle px-3 py-3 text-center">
              <a
                href={viewHref(row.userId)}
                class="text-caption font-medium text-primary hover:underline"
              >
                {labels.viewAction?.()}
              </a>
            </td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
