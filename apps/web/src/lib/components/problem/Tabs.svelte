<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemDifficulty, ProblemVisibility } from "@nojv/core";
  import { FileCode, Plus, Search } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  function formatAcceptanceRate(value: number): string {
    return `${String(Math.round(value * 100))}%`;
  }

  interface ProblemCard {
    acceptanceRate: number;
    difficulty: ProblemDifficulty;
    slug: string;
    tags: string[];
    title: string;
    totalSubmissions: number;
  }

  interface EditableProblemCard {
    difficulty: ProblemDifficulty;
    slug: string;
    tags: string[];
    title: string;
    visibility: ProblemVisibility;
  }

  type Difficulty = "all" | ProblemDifficulty;

  interface Props {
    editableProblems: EditableProblemCard[] | null;
    publicProblems: ProblemCard[];
    showCreate?: boolean;
    solvedSlugs?: string[];
  }

  let { editableProblems, publicProblems, showCreate, solvedSlugs }: Props = $props();

  let solvedSet = $derived(new Set(solvedSlugs ?? []));

  let tab = $state<"public" | "mine">("public");

  // Public filter state
  let publicSearch = $state("");
  let publicDifficulty = $state<Difficulty>("all");
  let publicSelectedTags = $state<Set<string>>(new Set());

  // Mine filter state
  let mineSearch = $state("");
  let mineDifficulty = $state<Difficulty>("all");
  let mineSelectedTags = $state<Set<string>>(new Set());

  // Derived: active filter values
  let activeSearch = $derived(tab === "public" ? publicSearch : mineSearch);
  let activeDifficulty = $derived(tab === "public" ? publicDifficulty : mineDifficulty);
  let activeSelectedTags = $derived(
    tab === "public" ? publicSelectedTags : mineSelectedTags
  );

  // Tag extraction
  let publicAllTags = $derived(
    [...new Set(publicProblems.flatMap((p) => p.tags))].sort()
  );
  let mineAllTags = $derived(
    [...new Set((editableProblems ?? []).flatMap((p) => p.tags))].sort()
  );
  let activeAllTags = $derived(tab === "public" ? publicAllTags : mineAllTags);

  // Filtering
  function filterProblems<
    T extends {
      difficulty: ProblemDifficulty;
      slug: string;
      tags: string[];
      title: string;
    }
  >(problems: T[], search: string, difficulty: Difficulty, selectedTags: Set<string>): T[] {
    const query = search.toLowerCase();
    return problems.filter((p) => {
      if (
        query &&
        !p.title.toLowerCase().includes(query) &&
        !p.slug.toLowerCase().includes(query)
      ) {
        return false;
      }
      if (difficulty !== "all" && p.difficulty !== difficulty) {
        return false;
      }
      if (
        selectedTags.size > 0 &&
        ![...selectedTags].every((tag) => p.tags.includes(tag))
      ) {
        return false;
      }
      return true;
    });
  }

  let publicFiltered = $derived(
    filterProblems(publicProblems, publicSearch, publicDifficulty, publicSelectedTags)
  );
  let mineFiltered = $derived(
    filterProblems(
      editableProblems ?? [],
      mineSearch,
      mineDifficulty,
      mineSelectedTags
    )
  );

  function setActiveSearch(val: string) {
    if (tab === "public") publicSearch = val;
    else mineSearch = val;
  }

  function setActiveDifficulty(val: Difficulty) {
    if (tab === "public") publicDifficulty = val;
    else mineDifficulty = val;
  }

  function toggleTag(tag: string) {
    if (tab === "public") {
      const next = new Set(publicSelectedTags);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      publicSelectedTags = next;
    } else {
      const next = new Set(mineSelectedTags);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      mineSelectedTags = next;
    }
  }

  function resetOther() {
    if (tab === "public") {
      mineSearch = "";
      mineDifficulty = "all";
      mineSelectedTags = new Set();
    } else {
      publicSearch = "";
      publicDifficulty = "all";
      publicSelectedTags = new Set();
    }
  }

  const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];
</script>

<div class="flex items-center gap-2">
  <button
    class="rounded-full border px-4 py-2 text-sm font-medium transition {tab === 'public'
      ? 'border-primary bg-primary text-white'
      : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
    onclick={() => {
      tab = "public";
      resetOther();
    }}
    type="button"
  >
    {m.problems_publicLibrary()}
  </button>
  {#if editableProblems !== null}
    <button
      class="rounded-full border px-4 py-2 text-sm font-medium transition {tab === 'mine'
        ? 'border-primary bg-primary text-white'
        : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
      onclick={() => {
        tab = "mine";
        resetOther();
      }}
      type="button"
    >
      {m.problems_myProblems()}
    </button>
  {/if}
  {#if showCreate}
    <a
      class="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
      href="/problems/create"
    >
      <Plus class="h-4 w-4" />
      {m.problems_createNew()}
    </a>
  {/if}
</div>

<!-- Filter bar -->
<div class="flex flex-col gap-3">
  <div class="relative">
    <svg
      class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.35-4.35" stroke-linecap="round"></path>
    </svg>
    <input
      class="w-full rounded-full border border-border py-2 pl-9 pr-4 text-sm outline-none focus:border-primary"
      oninput={(e) => setActiveSearch((e.target as HTMLInputElement).value)}
      placeholder={m.problems_searchProblems()}
      type="text"
      value={activeSearch}
    />
  </div>

  <div
    class="flex flex-wrap items-center gap-2"
    aria-label={m.problems_filterByDifficulty()}
    role="group"
  >
    <span class="text-xs font-medium text-muted-foreground">
      {m.common_difficulty()}:
    </span>
    {#each difficulties as d (d)}
      <button
        class="rounded-full border px-3 py-1 text-xs font-medium transition {activeDifficulty ===
        d
          ? 'border-primary bg-primary text-white'
          : 'border-border hover:bg-[color:var(--color-panel)]'}"
        onclick={() => setActiveDifficulty(d)}
        type="button"
      >
        {d === "all" ? m.problems_allDifficulties() : d.charAt(0).toUpperCase() + d.slice(1)}
      </button>
    {/each}
  </div>

  {#if activeAllTags.length > 0}
    <div
      class="flex flex-wrap items-center gap-2"
      aria-label={m.problems_filterByTag()}
      role="group"
    >
      {#each activeAllTags as tag (tag)}
        <button
          class="rounded-full border px-3 py-1 text-xs font-medium transition {activeSelectedTags.has(
            tag
          )
            ? 'border-primary bg-primary text-white'
            : 'border-border hover:bg-[color:var(--color-panel)]'}"
          onclick={() => toggleTag(tag)}
          type="button"
        >
          {tag}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if tab === "public"}
  <section class="grid gap-4">
    {#if publicProblems.length === 0}
      <EmptyState
        icon={FileCode}
        title={m.problems_empty()}
      />
    {:else if publicFiltered.length === 0}
      <EmptyState
        icon={Search}
        title={m.problems_noResults()}
      />
    {/if}
    {#each publicFiltered as problem (problem.slug)}
      <a
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] backdrop-blur-sm grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.8fr_0.8fr] sm:items-center transition hover:-translate-y-0.5"
        href="/problems/{problem.slug}"
      >
        <div>
          <div class="flex items-center gap-2">
            <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
              {problem.slug}
            </p>
            {#if solvedSet.has(problem.slug)}
              <svg class="h-5 w-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor" aria-label="Solved">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            {/if}
          </div>
          <h3 class="mt-2 text-2xl font-semibold">{problem.title}</h3>
        </div>
        <div>
          <p class="text-sm text-muted-foreground">{m.common_difficulty()}</p>
          <p class="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
        </div>
        <div class="sm:text-right">
          <p class="text-sm text-muted-foreground">{m.common_acceptance()}</p>
          <p class="mt-1 text-lg font-semibold">
            {formatAcceptanceRate(problem.acceptanceRate)}
          </p>
        </div>
      </a>
    {/each}
  </section>
{/if}

{#if tab === "mine" && editableProblems !== null}
  <section class="grid gap-4">
    {#if editableProblems.length === 0}
      <EmptyState
        icon={FileCode}
        title={m.problems_myProblemsEmpty()}
        actionHref="/problems/create"
        actionLabel={m.problems_createNew()}
      />
    {:else if mineFiltered.length === 0}
      <EmptyState
        icon={Search}
        title={m.problems_noResults()}
      />
    {/if}
    {#each mineFiltered as problem (problem.slug)}
      <a
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] backdrop-blur-sm grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr] sm:items-center transition hover:-translate-y-0.5"
        href="/problems/{problem.slug}"
      >
        <div>
          <p
            class="text-sm uppercase tracking-[0.18em] text-muted-foreground"
          >
            {problem.slug}
          </p>
          <h3 class="mt-2 text-2xl font-semibold">{problem.title}</h3>
        </div>
        <div>
          <p class="text-sm text-muted-foreground">{m.common_difficulty()}</p>
          <p class="mt-1 text-lg font-semibold capitalize">{problem.difficulty}</p>
        </div>
        <div class="sm:text-right">
          <span
            class="rounded-full border border-border px-3 py-1 text-xs font-medium {problem.visibility ===
            'public'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'}"
          >
            {problem.visibility}
          </span>
        </div>
      </a>
    {/each}
  </section>
{/if}
