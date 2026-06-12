<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Search from "@lucide/svelte/icons/search";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";

  import { m } from "$lib/paraglide/messages.js";

  interface CandidateProblem {
    difficulty: string;
    displayId: number | string;
    id: string;
    tags: string[];
    title: string;
  }

  interface Props {
    candidateProblems: CandidateProblem[];
    error?: unknown;
    problemIds: string[];
  }

  let { candidateProblems, error, problemIds = $bindable() }: Props = $props();

  let problemSearch = $state("");

  const filteredProblems = $derived.by(() => {
    const needle = problemSearch.trim().toLowerCase();
    const selected = new Set(problemIds);
    const pool = candidateProblems.filter((p) => !selected.has(p.id));
    if (!needle) return pool.slice(0, 12);
    return pool
      .filter((p) => {
        if (p.title.toLowerCase().includes(needle)) return true;
        if (p.id.toLowerCase().includes(needle)) return true;
        return p.tags.some((tag) => tag.toLowerCase().includes(needle));
      })
      .slice(0, 12);
  });

  const selectedDetails = $derived.by(() => {
    const lookup = new Map(candidateProblems.map((p) => [p.id, p]));
    return problemIds
      .map((id) => lookup.get(id))
      .filter((p): p is CandidateProblem => p !== undefined);
  });

  const errorText = $derived(formatError(error));

  function addProblem(id: string) {
    if (problemIds.includes(id)) return;
    problemIds = [...problemIds, id];
  }

  function removeProblem(id: string) {
    problemIds = problemIds.filter((pid) => pid !== id);
  }

  function moveProblem(id: string, delta: -1 | 1) {
    const next = [...problemIds];
    const index = next.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    problemIds = next;
  }

  function difficultyClass(difficulty: string): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    if (difficulty === "hard") return "text-destructive";
    return "text-muted-foreground";
  }

  function formatError(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ");
    if (typeof value === "object" && "_errors" in value) {
      const errors = (value as { _errors?: unknown })._errors;
      if (Array.isArray(errors)) {
        return errors.filter((v) => typeof v === "string").join(", ");
      }
    }
    return null;
  }
</script>

<div class="rounded-md border border-border bg-[color:var(--color-panel)]/60">
  <div class="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5">
    <Search class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    <input
      type="text"
      class="flex-1 bg-transparent text-body-sm outline-none"
      placeholder={m.examCreate_problemSearchPlaceholder()}
      bind:value={problemSearch}
    />
    <span class="text-caption text-muted-foreground">
      {m.examCreate_problemSearchCount({ count: filteredProblems.length })}
    </span>
  </div>
  <div class="max-h-56 overflow-y-auto p-1.5">
    {#each filteredProblems as problem (problem.id)}
      <button
        type="button"
        class="flex w-full items-center gap-3.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
        onclick={() => addProblem(problem.id)}
      >
        <span class="min-w-[96px] font-mono text-caption text-muted-foreground">
          #{problem.displayId}
        </span>
        <span class="flex-1 text-body-sm font-medium">{problem.title}</span>
        <span
          class="text-micro font-semibold uppercase tracking-[0.08em] {difficultyClass(
            problem.difficulty,
          )}"
        >
          {problem.difficulty}
        </span>
        <span
          class="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-muted-foreground"
        >
          <Plus aria-hidden="true" class="h-3.5 w-3.5" />
        </span>
      </button>
    {:else}
      <p class="px-3 py-6 text-center text-body-sm text-muted-foreground">
        {m.examCreate_problemSearchEmpty()}
      </p>
    {/each}
  </div>
</div>

{#if selectedDetails.length > 0}
  <div class="mt-4">
    <div
      class="flex items-center justify-between px-1 pb-2 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground"
    >
      <span>{m.examCreate_selectedProblemsCount({ count: selectedDetails.length })}</span>
      <span>{m.examCreate_selectedProblemsReorderHint()}</span>
    </div>
    <div class="space-y-2">
      {#each selectedDetails as problem, index (problem.id)}
        <div
          class="flex items-center gap-4 rounded-md border border-border bg-[color:var(--color-panel)] px-4 py-3 transition-colors hover:border-border-strong"
        >
          <span class="text-title-sm text-muted-foreground min-w-[20px] text-center">
            {index + 1}
          </span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-body-sm font-medium">{problem.title}</div>
            <div class="font-mono text-caption text-muted-foreground">
              #{problem.displayId}
            </div>
          </div>
          <span
            class="text-micro font-semibold uppercase tracking-[0.08em] {difficultyClass(
              problem.difficulty,
            )}"
          >
            {problem.difficulty}
          </span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={index === 0}
              onclick={() => moveProblem(problem.id, -1)}
              aria-label={m.examCreate_moveUp()}
            >
              <ChevronLeft aria-hidden="true" class="h-3.5 w-3.5 rotate-90" />
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={index === selectedDetails.length - 1}
              onclick={() => moveProblem(problem.id, 1)}
              aria-label={m.examCreate_moveDown()}
            >
              <ChevronRight aria-hidden="true" class="h-3.5 w-3.5 rotate-90" />
            </button>
          </div>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-[color:var(--color-destructive)]/8 hover:text-destructive"
            onclick={() => removeProblem(problem.id)}
            aria-label={m.examCreate_removeProblem()}
          >
            <X aria-hidden="true" class="h-3.5 w-3.5" />
          </button>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <p
    class="mt-4 rounded-md border border-dashed border-info/30 bg-[color:var(--color-info)]/5 px-4 py-3 text-body-sm text-muted-foreground"
  >
    {m.examCreate_problemsEmptyHint()}
  </p>
{/if}

{#if errorText}
  <p class="mt-2 text-xs text-destructive">{errorText}</p>
{/if}
