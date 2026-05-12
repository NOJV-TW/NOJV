<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ArrowDownNarrowWide, ArrowUpNarrowWide, CheckCircle2, FileCode, Search, Tags, XCircle } from "@lucide/svelte";
  import * as Card from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { difficultyClass, tagClass } from "$lib/types";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import type { problemDomain } from "@nojv/domain";
  import {
    difficulties,
    formatAcceptanceRate,
    renderJudgeMethod,
    renderProblemType,
    type Difficulty,
  } from "./problem-display";

  interface Props {
    publicResult: problemDomain.ProblemListResult;
  }

  let { publicResult }: Props = $props();

  let currentUrl = $derived($page.url);
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
  let sortDirection = $derived<"asc" | "desc">(
    currentUrl.searchParams.get("sort") === "desc" ? "desc" : "asc"
  );

  // We collect tags from the current page — but since server filters by tags already,
  // we need to provide all available tags. We'll show the tags from URL + result.
  let publicAllTags = $derived(
    [...new Set([
      ...publicResult.problems.flatMap((p) => p.tags),
      ...publicSelectedTags
    ])].sort()
  );

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchInputValue = $state("");
  let showPublicCardTags = $state(false);

  // Keep searchInputValue in sync when URL changes externally
  $effect(() => {
    searchInputValue = publicSearch;
  });

  function updateUrl(overrides: Record<string, string | undefined>) {
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

  function toggleSort() {
    updateUrl({ sort: sortDirection === "asc" ? "desc" : undefined });
  }

  function handleSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchInputValue = val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      updateUrl({ q: val || undefined });
    }, 300);
  }

  function setPublicDifficulty(d: Difficulty) {
    updateUrl({ difficulty: d === "all" ? undefined : d });
  }

  function togglePublicTag(tag: string) {
    const next = new Set(publicSelectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    const val = [...next].join(",");
    updateUrl({ tags: val || undefined });
  }

  function goToPage(p: number) {
    updateUrl({ page: p > 1 ? String(p) : undefined });
  }

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
</script>

<div class="flex flex-col gap-3">
  <div class="relative">
    <Search
      class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <Input
      class="pl-9 rounded-full"
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
    <span class="text-caption font-medium text-muted-foreground">
      {m.common_difficulty()}:
    </span>
    {#each difficulties as d (d)}
      <button
        class="rounded-full border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {publicDifficulty ===
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
      class="ml-auto inline-flex items-center justify-center rounded-full border border-border bg-[color:var(--color-panel)] p-1.5 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent hover:text-foreground"
      onclick={toggleSort}
      type="button"
      aria-label={sortDirection === "asc" ? m.problems_sortAsc() : m.problems_sortDesc()}
      title={sortDirection === "asc" ? m.problems_sortAsc() : m.problems_sortDesc()}
    >
      {#if sortDirection === "asc"}
        <ArrowUpNarrowWide class="size-4" aria-hidden="true" />
      {:else}
        <ArrowDownNarrowWide class="size-4" aria-hidden="true" />
      {/if}
    </button>
    <button
      class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-caption font-semibold text-primary transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-primary/15"
      aria-pressed={showPublicCardTags}
      onclick={() => { showPublicCardTags = !showPublicCardTags; }}
      type="button"
    >
      <Tags class="size-3.5" />
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
          class="rounded-full border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {publicSelectedTags.has(
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

<section class="grid gap-4">
  {#if publicResult.totalCount === 0 && !publicSearch && publicDifficulty === "all" && publicSelectedTags.size === 0}
    <EmptyState
      icon={FileCode}
      title={m.problems_empty()}
    />
  {:else if publicResult.problems.length === 0}
    <EmptyState
      icon={Search}
      variant="minimal"
      title={m.problems_noResults()}
    />
  {/if}
  {#each publicResult.problems as problem (problem.id)}
    <a href="/problems/{problem.id}" class="block">
      <Card.Root
        variant="surface"
        size="lg"
        interactive
        class="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center"
      >
        <div class="flex min-w-0 items-center gap-3">
          {#if problem.status === "ac"}
            <CheckCircle2 class="size-5 shrink-0 text-success" aria-label={m.problems_statusAc()} />
          {:else if problem.status === "attempted"}
            <XCircle class="size-5 shrink-0 text-warning" aria-label={m.problems_statusAttempted()} />
          {/if}
          <div class="min-w-0">
            <h3 class="text-title font-semibold">{formatProblemDisplayName(problem)}</h3>
            {#if problem.tags.length > 0}
              <div class="mt-1.5 flex flex-wrap items-center gap-1">
                {#each problem.tags as tag (tag)}
                  <span
                    class="inline-flex h-4 items-center rounded-full border px-1.5 text-[10px] font-medium capitalize leading-none {tagClass()}"
                  >
                    {tag}
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
        <div class="flex min-w-24 flex-col items-center text-center">
          <p class="text-body-sm text-muted-foreground">{m.problemDetail_problemTypeTitle()}</p>
          <p class="mt-1 text-body font-semibold">{renderProblemType(problem.type)}</p>
        </div>
        <div class="flex min-w-24 flex-col items-center text-center">
          <p class="text-body-sm text-muted-foreground">{m.problemDetail_judgeMethodTitle()}</p>
          <p class="mt-1 text-body font-semibold">
            {renderJudgeMethod(problem.type, problem.judgeType)}
          </p>
        </div>
        <div class="flex min-w-20 flex-col items-center text-center">
          <p class="text-body-sm text-muted-foreground">{m.common_difficulty()}</p>
          <span
            class="mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold capitalize {difficultyClass(problem.difficulty)}"
          >
            {problem.difficulty}
          </span>
        </div>
        <div class="flex min-w-16 flex-col items-center text-center">
          <p class="text-body-sm text-muted-foreground">{m.common_acceptance()}</p>
          <p class="mt-1 text-body-lg font-semibold tabular-nums">
            {formatAcceptanceRate(problem.acceptanceRate, problem.totalSubmissions)}
          </p>
        </div>
      </Card.Root>
    </a>
  {/each}
</section>

{#if totalPages > 1}
  <nav class="flex justify-center gap-2 pt-2" aria-label={m.problems_pagination()}>
    {#if currentPage > 1}
      <button
        class="rounded-full border border-border px-3 py-1 text-body-sm font-medium tabular-nums transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)]"
        onclick={() => goToPage(currentPage - 1)}
        type="button"
        aria-label={m.problems_previousPage()}
      >
        &larr;
      </button>
    {/if}
    {#each paginationPages as p, i (p === -1 ? `ellipsis-${String(i)}` : p)}
      {#if p === -1}
        <span class="px-2 py-1 text-body-sm text-muted-foreground">&hellip;</span>
      {:else}
        <button
          class="rounded-full border px-3 py-1 text-body-sm font-medium tabular-nums transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {p === currentPage
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
        class="rounded-full border border-border px-3 py-1 text-body-sm font-medium tabular-nums transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)]"
        onclick={() => goToPage(currentPage + 1)}
        type="button"
        aria-label={m.problems_nextPage()}
      >
        &rarr;
      </button>
    {/if}
  </nav>
{/if}
