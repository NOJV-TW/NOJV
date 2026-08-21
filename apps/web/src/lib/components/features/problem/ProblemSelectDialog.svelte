<script lang="ts" module>
  import type { problemDomain } from "@nojv/application";

  export type CandidateProblem = problemDomain.ProblemPickerCandidate;
  export type CandidateProblemGroups = problemDomain.ProblemPickerGroups;
</script>

<script lang="ts">
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css";
  import { matchesProblemPickerSearch } from "$lib/utils/problem-picker";
  import Check from "@lucide/svelte/icons/check";
  import Search from "@lucide/svelte/icons/search";

  interface Props {
    candidateProblems: CandidateProblemGroups;
    selectedIds: string[];
    open?: boolean;
    onConfirm: (problems: CandidateProblem[]) => void;
  }

  let { candidateProblems, selectedIds, open = $bindable(false), onConfirm }: Props = $props();

  let searchQuery = $state("");
  let pendingIds = $state<Set<string>>(new Set());
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      searchQuery = "";
      pendingIds = new Set();
    }
    wasOpen = open;
  });

  const selectedIdSet = $derived(new Set(selectedIds));
  const sections = $derived.by(() => {
    const publicIds = new Set(candidateProblems.publicProblems.map((problem) => problem.id));
    return [
      {
        key: "public",
        label: m.problems_publicLibrary(),
        problems: candidateProblems.publicProblems,
      },
      {
        key: "personal",
        label: m.problems_myProblems(),
        problems: candidateProblems.personalProblems.filter(
          (problem) => !publicIds.has(problem.id),
        ),
      },
    ];
  });
  const filteredSections = $derived(
    sections
      .map((section) => ({
        ...section,
        problems: section.problems
          .filter((problem) => !selectedIdSet.has(problem.id))
          .filter(
            (problem) =>
              !searchQuery.trim() || matchesProblemPickerSearch(problem, searchQuery),
          )
          .slice(0, 40),
      }))
      .filter((section) => section.problems.length > 0),
  );
  const visibleCount = $derived(
    filteredSections.reduce((count, section) => count + section.problems.length, 0),
  );
  const availableCount = $derived(
    sections.reduce(
      (count, section) =>
        count + section.problems.filter((problem) => !selectedIdSet.has(problem.id)).length,
      0,
    ),
  );

  function toggleProblem(problemId: string) {
    const next = new Set(pendingIds);
    if (next.has(problemId)) next.delete(problemId);
    else next.add(problemId);
    pendingIds = next;
  }

  function confirmSelection() {
    const candidates = new Map(
      sections.flatMap((section) => section.problems).map((problem) => [problem.id, problem]),
    );
    onConfirm(
      [...pendingIds]
        .map((problemId) => candidates.get(problemId))
        .filter((problem): problem is CandidateProblem => problem !== undefined),
    );
    open = false;
  }

  function difficultyClass(difficulty: string): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    if (difficulty === "hard") return "text-destructive";
    return "text-muted-foreground";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="max-h-[min(760px,calc(100dvh-2rem))] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
  >
    <Dialog.Header class="border-b border-border-subtle px-6 pb-4 pt-6 pe-14">
      <Dialog.Title>{m.problemPicker_dialogTitle()}</Dialog.Title>
      <Dialog.Description>{m.problemPicker_dialogDescription()}</Dialog.Description>
    </Dialog.Header>

    <div class="flex items-center gap-2.5 border-b border-border-subtle px-6 py-3">
      <Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        placeholder={m.problemPicker_searchPlaceholder()}
        bind:value={searchQuery}
        class="min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-muted-foreground"
        aria-label={m.problemPicker_searchPlaceholder()}
      />
      <span class="shrink-0 text-caption text-muted-foreground">
        {m.problemPicker_availableCount({
          count: searchQuery.trim() ? visibleCount : availableCount,
        })}
      </span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if filteredSections.length === 0}
        <p class="px-3 py-12 text-center text-body-sm text-muted-foreground">
          {m.problemPicker_searchEmpty()}
        </p>
      {:else}
        {#each filteredSections as section (section.key)}
          <section class="mb-4 last:mb-0">
            <h3
              class="px-3 pb-2 pt-1 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            >
              {section.label}
            </h3>
            <div class="space-y-1">
              {#each section.problems as problem (problem.id)}
                {@const checked = pendingIds.has(problem.id)}
                <label
                  class={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 transition-colors",
                    checked ? "bg-primary/8" : "hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    {checked}
                    onchange={() => toggleProblem(problem.id)}
                    class="peer sr-only"
                  />
                  <span
                    class={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border-strong bg-background",
                      "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                    )}
                    aria-hidden="true"
                  >
                    {#if checked}
                      <Check class="size-3.5" />
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-body-sm font-medium">{problem.title}</span>
                    <span
                      class="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground"
                    >
                      <span class="font-mono">
                        {problem.displayId == null
                          ? m.common_problemDraft()
                          : `#${problem.displayId}`}
                      </span>
                      <span class={difficultyClass(problem.difficulty)}
                        >{problem.difficulty}</span
                      >
                      <span>{problem.judgeType}</span>
                    </span>
                  </span>
                </label>
              {/each}
            </div>
          </section>
        {/each}
      {/if}
    </div>

    <Dialog.Footer
      class="flex-col items-stretch border-t border-border-subtle px-6 py-4 sm:flex-row sm:items-center"
    >
      <span class="text-center text-caption text-muted-foreground sm:mr-auto sm:text-start">
        {m.problemPicker_selectedCount({ count: pendingIds.size })}
      </span>
      <Button type="button" variant="ghost" size="sm" onclick={() => (open = false)}>
        {m.common_cancel()}
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={pendingIds.size === 0}
        onclick={confirmSelection}
      >
        {m.problemPicker_confirmButton()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
