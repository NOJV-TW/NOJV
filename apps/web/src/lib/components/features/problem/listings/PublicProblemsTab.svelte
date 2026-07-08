<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { CheckCircle2, FileCode, ListFilter, Search, XCircle } from "@lucide/svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import * as Card from "$lib/components/primitives/ui/card";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { difficultyClass, tagClass } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import type { problemDomain } from "@nojv/application";
  import {
    formatAcceptanceRate,
    renderJudgeMethod,
    renderProblemType,
  } from "../problem-display";
  import ProblemFilterSidebar from "./ProblemFilterSidebar.svelte";
  import BookmarkButton from "./BookmarkButton.svelte";

  interface Props {
    publicResult: problemDomain.ProblemListResult;
    loggedIn: boolean;
    showCreate?: boolean;
  }

  let { publicResult, loggedIn, showCreate = false }: Props = $props();

  let currentUrl = $derived(page.url);
  let currentPage = $derived(publicResult.page);
  let totalPages = $derived(
    Math.max(1, Math.ceil(publicResult.totalCount / publicResult.pageSize)),
  );
  let hasActiveFilters = $derived(
    [...currentUrl.searchParams.keys()].some((k) =>
      ["q", "difficulty", "status", "types", "judge", "tags"].includes(k),
    ),
  );

  let filtersOpen = $state(false);

  function goToPage(p: number) {
    const params = new URLSearchParams(currentUrl.searchParams);
    if (p > 1) params.set("page", String(p));
    else params.delete("page");
    const qs = params.toString();
    void goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: false });
  }

  function clearFilters() {
    const params = new URLSearchParams(currentUrl.searchParams);
    for (const key of ["q", "difficulty", "status", "types", "judge", "tags", "page"]) {
      params.delete(key);
    }
    const qs = params.toString();
    void goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: true });
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
      if (currentPage <= 3) end = Math.min(totalPages - 1, 4);
      if (currentPage >= totalPages - 2) start = Math.max(2, totalPages - 3);
      if (start > 2) pages.push(-1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages - 1) pages.push(-1);
      pages.push(totalPages);
    }
    return pages;
  });
</script>

<div class="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
  <aside class="hidden lg:block">
    <div class="sticky top-6">
      <ProblemFilterSidebar {publicResult} {loggedIn} />
    </div>
  </aside>

  <div class="flex min-w-0 flex-col gap-4">
    <button
      type="button"
      onclick={() => {
        filtersOpen = true;
      }}
      class="inline-flex items-center justify-center gap-2 self-start rounded-full border border-border bg-[color:var(--color-panel)] px-4 py-2 text-body-sm font-medium text-foreground transition-[background-color] duration-fast ease-out-soft hover:bg-accent lg:hidden"
    >
      <ListFilter class="size-4" aria-hidden="true" />
      {m.problems_openFilters()}
    </button>

    <section class="grid gap-4">
      {#if publicResult.totalCount === 0 && !hasActiveFilters}
        <EmptyState
          icon={FileCode}
          variant="onboarding"
          title={m.problems_empty()}
          description={m.problems_emptyDescription()}
          actions={showCreate
            ? [{ href: "?tab=mine", label: m.problems_createFirst() }]
            : [{ href: "/courses", label: m.dashboard_welcomeGuideBrowseCourses() }]}
        />
      {:else if publicResult.problems.length === 0}
        <div class="flex flex-col items-center gap-4 py-16">
          <EmptyState
            icon={Search}
            variant="minimal"
            title={m.problems_noResults()}
            class="py-0"
          />
          <Button variant="outline" size="sm" onclick={clearFilters}>
            {m.problems_clearFilters()}
          </Button>
        </div>
      {/if}

      {#if publicResult.problems.length > 0}
        <div
          class="hidden border border-transparent px-4 text-caption font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] sm:items-center sm:gap-x-8"
        >
          <span>{m.problems_columnProblem()}</span>
          <span class="min-w-24 text-center">{m.problemDetail_problemTypeTitle()}</span>
          <span class="min-w-24 text-center">{m.problemDetail_judgeMethodTitle()}</span>
          <span class="min-w-20 text-center">{m.common_difficulty()}</span>
          <span class="min-w-16 text-center">{m.common_acceptance()}</span>
          {#if loggedIn}<span aria-hidden="true"></span>{/if}
        </div>
      {/if}

      {#each publicResult.problems as problem, index (problem.id)}
        <Card.Root
          variant="surface"
          size="lg"
          interactive
          style="animation-delay: {Math.min(index * 30, 300)}ms"
          class="relative grid gap-x-8 gap-y-3 px-4 py-3 motion-safe:animate-[fade-up_400ms_var(--ease-out-soft)_both] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] sm:items-center"
        >
          <div class="flex min-w-0 items-center gap-3">
            {#if problem.status === "ac"}
              <CheckCircle2
                aria-hidden="true"
                class="size-5 shrink-0 text-success"
                aria-label={m.problems_statusAc()}
              />
            {:else if problem.status === "attempted"}
              <XCircle
                aria-hidden="true"
                class="size-5 shrink-0 text-warning"
                aria-label={m.problems_statusAttempted()}
              />
            {:else}
              <span class="size-5 shrink-0" aria-hidden="true"></span>
            {/if}
            <div class="min-w-0">
              <h3 class="text-title font-semibold">
                <a
                  href="/problems/{problem.id}"
                  class="after:absolute after:inset-0 focus:outline-none focus-visible:underline"
                >
                  {formatProblemDisplayName(problem)}
                </a>
              </h3>
              {#if problem.tags.length > 0}
                <div class="mt-1.5 flex flex-wrap items-center gap-1">
                  {#each problem.tags as tag (tag)}
                    <span
                      class="inline-flex items-center rounded-full border px-1.5 py-0.5 text-caption font-medium capitalize leading-none {tagClass()}"
                    >
                      {tag}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <div class="flex min-w-24 flex-col items-center text-center">
            <p class="text-body-sm text-muted-foreground sm:hidden">
              {m.problemDetail_problemTypeTitle()}
            </p>
            <p class="mt-1 text-body font-semibold">{renderProblemType(problem.type)}</p>
          </div>
          <div class="flex min-w-24 flex-col items-center text-center">
            <p class="text-body-sm text-muted-foreground sm:hidden">
              {m.problemDetail_judgeMethodTitle()}
            </p>
            <p class="mt-1 text-body font-semibold">
              {renderJudgeMethod(problem.type, problem.judgeType)}
            </p>
          </div>
          <div class="flex min-w-20 flex-col items-center text-center">
            <p class="text-body-sm text-muted-foreground sm:hidden">{m.common_difficulty()}</p>
            <span
              class="mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold capitalize {difficultyClass(
                problem.difficulty,
              )}"
            >
              {problem.difficulty}
            </span>
          </div>
          <div class="flex min-w-16 flex-col items-center text-center">
            <p class="text-body-sm text-muted-foreground sm:hidden">{m.common_acceptance()}</p>
            <p class="mt-1 text-body-lg font-semibold tabular-nums">
              {formatAcceptanceRate(problem.acceptanceRate, problem.totalSubmissions)}
            </p>
          </div>
          {#if loggedIn}
            <div class="relative z-10 flex justify-end sm:justify-center">
              <BookmarkButton problemId={problem.id} bookmarked={problem.bookmarked} />
            </div>
          {/if}
        </Card.Root>
      {/each}
    </section>

    {#if totalPages > 1}
      <nav class="flex justify-center gap-2 pt-2" aria-label={m.problems_pagination()}>
        {#if currentPage > 1}
          <button
            class="inline-flex items-center justify-center rounded-full border border-border px-3 py-1 text-body-sm font-medium tabular-nums transition-[background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
              class="inline-flex items-center justify-center rounded-full border px-3 py-1 text-body-sm font-medium tabular-nums transition-[background-color] duration-fast ease-out-soft pointer-coarse:min-h-11 pointer-coarse:min-w-11 {p ===
              currentPage
                ? 'border-primary bg-primary text-primary-foreground'
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
            class="inline-flex items-center justify-center rounded-full border border-border px-3 py-1 text-body-sm font-medium tabular-nums transition-[background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onclick={() => goToPage(currentPage + 1)}
            type="button"
            aria-label={m.problems_nextPage()}
          >
            &rarr;
          </button>
        {/if}
      </nav>
    {/if}
  </div>
</div>

<Dialog.Root bind:open={filtersOpen}>
  <Dialog.Content showCloseButton class="max-h-[85vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{m.problems_openFilters()}</Dialog.Title>
    </Dialog.Header>
    <ProblemFilterSidebar {publicResult} {loggedIn} />
  </Dialog.Content>
</Dialog.Root>
