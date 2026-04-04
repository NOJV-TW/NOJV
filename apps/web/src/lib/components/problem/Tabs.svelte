<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { difficultyColor } from "$lib/types";
  import type { ProblemDifficulty, ProblemVisibility } from "@nojv/core";
  import { FileCode, Pencil, Search, Tags } from "@lucide/svelte";

  let creating = $state(false);

  async function handleCreate() {
    creating = true;
    try {
      const res = await fetch("/api/problems/create", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create problem");
      const { id } = await res.json();
      await goto(`/problems/${id}/edit`);
    } finally {
      creating = false;
    }
  }
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import type { problemDomain } from "@nojv/domain";
  type ProblemCardWithStatus = problemDomain.ProblemCardWithStatus;
  type ProblemListResult = problemDomain.ProblemListResult;

  function formatAcceptanceRate(value: number): string {
    return `${String(Math.round(value * 100))}%`;
  }

  interface EditableProblemCard {
    difficulty: ProblemDifficulty;
    id: string;
    status: string;
    tags: string[];
    title: string;
    visibility: ProblemVisibility;
  }

  type Difficulty = "all" | ProblemDifficulty;

  interface Props {
    editableProblems: EditableProblemCard[] | null;
    publicResult: ProblemListResult;
    showCreate?: boolean;
  }

  let { editableProblems, publicResult, showCreate }: Props = $props();

  // ─── Public tab: URL-driven state ─────────────────────────────────
  let currentUrl = $derived($page.url);
  let tab = $derived<"public" | "mine">(
    showCreate && currentUrl.searchParams.get("tab") === "mine" ? "mine" : "public"
  );
  let publicSearch = $derived(currentUrl.searchParams.get("q") ?? "");
  let publicDifficulty = $derived<Difficulty>(
    (currentUrl.searchParams.get("difficulty") as Difficulty) || "all"
  );
  let publicSelectedTags = $derived<Set<string>>(
    new Set(
      (currentUrl.searchParams.get("tags") ?? "")
        .split(",")
        .filter(Boolean)
    )
  );
  let currentPage = $derived(publicResult.page);
  let totalPages = $derived(Math.max(1, Math.ceil(publicResult.totalCount / publicResult.pageSize)));

  // All tags from current result (for tag filter chips)
  // We collect tags from the current page — but since server filters by tags already,
  // we need to provide all available tags. We'll show the tags from URL + result.
  let publicAllTags = $derived(
    [...new Set([
      ...publicResult.problems.flatMap((p) => p.tags),
      ...publicSelectedTags
    ])].sort()
  );

  // Debounce timer for search input
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchInputValue = $state("");

  // Keep searchInputValue in sync when URL changes externally
  $effect(() => {
    searchInputValue = publicSearch;
  });

  function updatePublicUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(currentUrl.searchParams);
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined || val === "" || val === "all") {
        params.delete(key);
      } else {
        params.set(key, val);
      }
    }
    // Reset to page 1 when filters change (unless page itself is being set)
    if (!("page" in overrides)) {
      params.delete("page");
    }
    const qs = params.toString();
    goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: "page" in overrides ? false : true });
  }

  function handleSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchInputValue = val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      updatePublicUrl({ q: val || undefined });
    }, 300);
  }

  function setPublicDifficulty(d: Difficulty) {
    updatePublicUrl({ difficulty: d === "all" ? undefined : d });
  }

  function togglePublicTag(tag: string) {
    const next = new Set(publicSelectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    const val = [...next].join(",");
    updatePublicUrl({ tags: val || undefined });
  }

  function goToPage(p: number) {
    updatePublicUrl({ page: p > 1 ? String(p) : undefined });
  }

  function setTab(nextTab: "public" | "mine") {
    const params = new URLSearchParams(currentUrl.searchParams);
    if (nextTab === "mine") {
      params.set("tab", "mine");
    } else {
      params.delete("tab");
    }
    const qs = params.toString();
    goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: true });
  }

  // Build page numbers for pagination
  let paginationPages = $derived.by(() => {
    const pages: number[] = [];
    const maxVisible = 7;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);
      if (currentPage <= 3) {
        end = Math.min(totalPages - 1, 4);
      }
      if (currentPage >= totalPages - 2) {
        start = Math.max(2, totalPages - 3);
      }
      if (start > 2) pages.push(-1); // ellipsis
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages - 1) pages.push(-1); // ellipsis
      pages.push(totalPages);
    }
    return pages;
  });

  // ─── Mine tab: client-side filtering (unchanged) ──────────────────
  let mineSearch = $state("");
  let mineDifficulty = $state<Difficulty>("all");
  let mineSelectedTags = $state<Set<string>>(new Set());

  let mineAllTags = $derived(
    [...new Set((editableProblems ?? []).flatMap((p) => p.tags))].sort()
  );
  let showPublicCardTags = $state(false);
  let showMineCardTags = $state(false);

  function filterProblems<
    T extends {
      difficulty: ProblemDifficulty;
      id: string;
      tags: string[];
      title: string;
    }
  >(problems: T[], search: string, difficulty: Difficulty, selectedTags: Set<string>): T[] {
    const query = search.toLowerCase();
    return problems.filter((p) => {
      if (
        query &&
        !p.title.toLowerCase().includes(query)
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

  let mineFiltered = $derived(
    filterProblems(
      editableProblems ?? [],
      mineSearch,
      mineDifficulty,
      mineSelectedTags
    )
  );

  function toggleMineTag(tag: string) {
    const next = new Set(mineSelectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    mineSelectedTags = next;
  }

  const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];
</script>

<div class="flex items-center gap-2">
  <button
    class="rounded-full border px-4 py-2 text-sm font-medium transition {tab === 'public'
      ? 'border-primary bg-primary text-white'
      : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
    onclick={() => setTab("public")}
    type="button"
  >
    {m.problems_publicLibrary()}
  </button>
  {#if showCreate}
    <button
      class="rounded-full border px-4 py-2 text-sm font-medium transition {tab === 'mine'
        ? 'border-primary bg-primary text-white'
        : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
      onclick={() => setTab("mine")}
      type="button"
    >
      {m.problems_myProblems()}
    </button>
    <button
      class="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={creating}
      onclick={handleCreate}
      type="button"
    >
      + {creating ? m.common_saving() : m.problems_createNew()}
    </button>
  {/if}
</div>

{#if tab === "public"}
  <!-- Public tab: filter bar (URL-driven) -->
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
        oninput={handleSearchInput}
        placeholder={m.problems_searchProblems()}
        type="text"
        value={searchInputValue}
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
          class="rounded-full border px-3 py-1 text-xs font-medium transition {publicDifficulty ===
          d
            ? 'border-primary bg-primary text-white'
            : 'border-border hover:bg-[color:var(--color-panel)]'}"
          onclick={() => setPublicDifficulty(d)}
          type="button"
        >
          {d === "all" ? m.problems_allDifficulties() : d.charAt(0).toUpperCase() + d.slice(1)}
        </button>
      {/each}
      <button
        class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:-translate-y-0.5 hover:bg-primary/15"
        onclick={() => { showPublicCardTags = !showPublicCardTags; }}
        type="button"
      >
        <Tags class="h-3.5 w-3.5" />
        {showPublicCardTags ? m.problems_hideMoreTags() : m.problems_showMoreTags()}
      </button>
    </div>

    {#if showPublicCardTags && publicAllTags.length > 0}
      <div
        class="flex flex-wrap items-center gap-2"
        aria-label={m.problems_filterByTag()}
        role="group"
      >
        {#each publicAllTags as tag (tag)}
          <button
            class="rounded-full border px-3 py-1 text-xs font-medium transition {publicSelectedTags.has(
              tag
            )
              ? 'border-primary bg-primary text-white'
              : 'border-border hover:bg-[color:var(--color-panel)]'}"
            onclick={() => togglePublicTag(tag)}
            type="button"
          >
            {tag}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Public problem list -->
  <section class="grid gap-4">
    {#if publicResult.totalCount === 0 && !publicSearch && publicDifficulty === "all" && publicSelectedTags.size === 0}
      <EmptyState
        icon={FileCode}
        title={m.problems_empty()}
      />
    {:else if publicResult.problems.length === 0}
      <EmptyState
        icon={Search}
        title={m.problems_noResults()}
      />
    {/if}
    {#each publicResult.problems as problem (problem.id)}
      <a
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] backdrop-blur-sm grid gap-4 px-5 py-5 sm:grid-cols-[auto_1.4fr_0.8fr_0.8fr] sm:items-center transition hover:-translate-y-0.5"
        href="/problems/{problem.id}"
      >
        <div class="flex items-center justify-center w-6">
          {#if problem.status === "ac"}
            <svg class="h-5 w-5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor" aria-label={m.problems_statusAc()}>
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          {:else if problem.status === "attempted"}
            <svg class="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-label={m.problems_statusAttempted()}>
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          {/if}
        </div>
        <div>
          <h3 class="text-2xl font-semibold">{problem.title}</h3>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize {difficultyColor[
              problem.difficulty
            ] ?? 'bg-muted text-muted-foreground'}"
          >
            {problem.difficulty}
          </span>
          {#if showPublicCardTags && problem.tags.length > 0}
            {#each problem.tags as tag (tag)}
              <span class="inline-flex rounded-full border border-border bg-muted/40 px-3 py-1 text-sm font-semibold text-muted-foreground">
                {tag}
              </span>
            {/each}
          {/if}
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

  <!-- Pagination -->
  {#if totalPages > 1}
    <nav class="flex justify-center gap-2 pt-2" aria-label={m.problems_pagination()}>
      {#if currentPage > 1}
        <button
          class="rounded-full border border-border px-3 py-1 text-sm font-medium transition hover:bg-[color:var(--color-panel)]"
          onclick={() => goToPage(currentPage - 1)}
          type="button"
          aria-label={m.problems_previousPage()}
        >
          &larr;
        </button>
      {/if}
      {#each paginationPages as p, i (p === -1 ? `ellipsis-${String(i)}` : p)}
        {#if p === -1}
          <span class="px-2 py-1 text-sm text-muted-foreground">&hellip;</span>
        {:else}
          <button
            class="rounded-full border px-3 py-1 text-sm font-medium transition {p === currentPage
              ? 'border-primary bg-primary text-white'
              : 'border-border hover:bg-[color:var(--color-panel)]'}"
            onclick={() => goToPage(p)}
            type="button"
          >
            {p}
          </button>
        {/if}
      {/each}
      {#if currentPage < totalPages}
        <button
          class="rounded-full border border-border px-3 py-1 text-sm font-medium transition hover:bg-[color:var(--color-panel)]"
          onclick={() => goToPage(currentPage + 1)}
          type="button"
          aria-label={m.problems_nextPage()}
        >
          &rarr;
        </button>
      {/if}
    </nav>
  {/if}
{/if}

{#if tab === "mine" && showCreate}
  <!-- Mine tab: filter bar (client-side) -->
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
        oninput={(e) => { mineSearch = (e.target as HTMLInputElement).value; }}
        placeholder={m.problems_searchProblems()}
        type="text"
        value={mineSearch}
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
          class="rounded-full border px-3 py-1 text-xs font-medium transition {mineDifficulty ===
          d
            ? 'border-primary bg-primary text-white'
            : 'border-border hover:bg-[color:var(--color-panel)]'}"
          onclick={() => { mineDifficulty = d; }}
          type="button"
        >
          {d === "all" ? m.problems_allDifficulties() : d.charAt(0).toUpperCase() + d.slice(1)}
        </button>
      {/each}
      <button
        class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:-translate-y-0.5 hover:bg-primary/15"
        onclick={() => { showMineCardTags = !showMineCardTags; }}
        type="button"
      >
        <Tags class="h-3.5 w-3.5" />
        {showMineCardTags ? m.problems_hideMoreTags() : m.problems_showMoreTags()}
      </button>
    </div>

    {#if showMineCardTags && mineAllTags.length > 0}
      <div
        class="flex flex-wrap items-center gap-2"
        aria-label={m.problems_filterByTag()}
        role="group"
      >
        {#each mineAllTags as tag (tag)}
          <button
            class="rounded-full border px-3 py-1 text-xs font-medium transition {mineSelectedTags.has(
              tag
            )
              ? 'border-primary bg-primary text-white'
              : 'border-border hover:bg-[color:var(--color-panel)]'}"
            onclick={() => toggleMineTag(tag)}
            type="button"
          >
            {tag}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <section class="grid gap-4">
    {#if (editableProblems?.length ?? 0) === 0}
      <EmptyState
        icon={FileCode}
        title={m.problems_myProblemsEmpty()}
      />
    {:else if mineFiltered.length === 0}
      <EmptyState
        icon={Search}
        title={m.problems_noResults()}
      />
    {/if}
    {#each mineFiltered as problem (problem.id)}
      <div
        class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] backdrop-blur-sm grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_auto] sm:items-center"
      >
        <a href="/problems/{problem.id}" class="transition hover:opacity-80">
          <h3 class="text-2xl font-semibold">{problem.title}</h3>
        </a>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize {difficultyColor[
              problem.difficulty
            ] ?? 'bg-muted text-muted-foreground'}"
          >
            {problem.difficulty}
          </span>
          {#if showMineCardTags && problem.tags.length > 0}
            {#each problem.tags as tag (tag)}
              <span class="inline-flex rounded-full border border-border bg-muted/40 px-3 py-1 text-sm font-semibold text-muted-foreground">
                {tag}
              </span>
            {/each}
          {/if}
        </div>
        <div class="flex flex-wrap gap-1.5 sm:justify-end">
          {#if problem.status === "draft"}
            <span class="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              Draft
            </span>
          {/if}
          <span
            class="rounded-full border border-border px-3 py-1 text-xs font-medium {problem.visibility === 'public'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground'}"
          >
            {problem.visibility}
          </span>
        </div>
        <a
          href="/problems/{problem.id}/edit"
          class="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground hover:bg-[color:var(--color-panel)]"
        >
          <Pencil class="h-3 w-3" />
          {m.problemDetail_editProblem()}
        </a>
      </div>
    {/each}
  </section>
{/if}
