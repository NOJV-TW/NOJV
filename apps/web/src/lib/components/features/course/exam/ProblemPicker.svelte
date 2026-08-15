<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import type { problemDomain } from "@nojv/application";

  import { m } from "$lib/paraglide/messages.js";
  import { matchesProblemPickerSearch } from "$lib/utils/problem-picker";

  type CandidateProblem = problemDomain.ProblemPickerCandidate;
  type CandidateGroups = problemDomain.ProblemPickerGroups;

  interface Props {
    candidateProblems: CandidateGroups;
    error?: unknown;
    onProblemIdsChange?: (ids: string[]) => void;
    problemIds: string[];
    showSelected?: boolean;
  }

  let {
    candidateProblems,
    error,
    onProblemIdsChange,
    problemIds = $bindable(),
    showSelected = true,
  }: Props = $props();

  let problemSearch = $state("");

  const filteredSections = $derived.by(() => {
    const selected = new Set(problemIds);
    const sections = [
      {
        key: "public",
        label: m.problems_publicLibrary(),
        problems: candidateProblems.publicProblems,
      },
      {
        key: "personal",
        label: m.problems_myProblems(),
        problems: candidateProblems.personalProblems,
      },
    ];

    return sections
      .map((section) => ({
        ...section,
        problems: section.problems
          .filter((problem) => !selected.has(problem.id))
          .filter((problem) => matchesProblemPickerSearch(problem, problemSearch))
          .slice(0, 12),
      }))
      .filter((section) => section.problems.length > 0);
  });

  const visibleCount = $derived(
    filteredSections.reduce((count, section) => count + section.problems.length, 0),
  );

  const selectedDetails = $derived.by(() => {
    const lookup = new Map<CandidateProblem["id"], CandidateProblem>(
      [...candidateProblems.publicProblems, ...candidateProblems.personalProblems].map(
        (problem) => [problem.id, problem],
      ),
    );
    return problemIds
      .map((id) => lookup.get(id))
      .filter((problem): problem is CandidateProblem => problem !== undefined);
  });

  const errorText = $derived(formatError(error));

  function setProblemIds(next: string[]) {
    problemIds = next;
    onProblemIdsChange?.(next);
  }

  function addProblem(id: string) {
    if (problemIds.includes(id)) return;
    setProblemIds([...problemIds, id]);
  }

  function removeProblem(id: string) {
    setProblemIds(problemIds.filter((problemId) => problemId !== id));
  }

  function moveProblem(id: string, delta: -1 | 1) {
    const next = [...problemIds];
    const index = next.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setProblemIds(next);
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
    if (typeof value === "object" && value !== null && "_errors" in value) {
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
      {m.examCreate_problemSearchCount({ count: visibleCount })}
    </span>
  </div>

  <div class="max-h-72 overflow-y-auto p-1.5">
    {#if problemSearch.trim()}
      {#each filteredSections as section (section.key)}
        <section>
          <h3
            class="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {section.label}
          </h3>
          {#each section.problems as problem (problem.id)}
            <button
              type="button"
              class="flex w-full items-center gap-3.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
              onclick={() => addProblem(problem.id)}
            >
              <span class="min-w-[96px] font-mono text-caption text-muted-foreground">
                {problem.displayId == null ? m.common_problemDraft() : `#${problem.displayId}`}
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
          {/each}
        </section>
      {:else}
        <p class="px-3 py-6 text-center text-body-sm text-muted-foreground">
          {m.examCreate_problemSearchEmpty()}
        </p>
      {/each}
    {/if}
  </div>
</div>

{#if showSelected && selectedDetails.length > 0}
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
              {problem.displayId == null ? m.common_problemDraft() : `#${problem.displayId}`}
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
{:else if showSelected}
  <p
    class="mt-4 rounded-md border border-dashed border-info/30 bg-[color:var(--color-info)]/5 px-4 py-3 text-body-sm text-muted-foreground"
  >
    {m.examCreate_problemsEmptyHint()}
  </p>
{/if}

{#if errorText}
  <p class="mt-2 text-xs text-destructive">{errorText}</p>
{/if}
