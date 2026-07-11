<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { CheckCircle2, FileCode, ListFilter, Loader2, Search, XCircle } from "@lucide/svelte";
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

  type ProblemCard = problemDomain.ProblemListResult["problems"][number];

  let currentUrl = $derived(page.url);
  let hasActiveFilters = $derived(
    [...currentUrl.searchParams.keys()].some((k) =>
      ["q", "difficulty", "status", "types", "judge", "tags"].includes(k),
    ),
  );

  let filtersOpen = $state(false);

  let extra = $state<ProblemCard[]>([]);
  let pagesLoaded = $state(0);
  let loadingMore = $state(false);
  let exhausted = $state(false);
  let sentinel = $state<HTMLElement | null>(null);

  $effect(() => {
    void publicResult;
    extra = [];
    pagesLoaded = 0;
    exhausted = false;
  });

  let allProblems = $derived.by(() => {
    const seen = new Set<string>();
    const rows: ProblemCard[] = [];
    for (const row of [...publicResult.problems, ...extra]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  });

  let hasMore = $derived(!exhausted && allProblems.length < publicResult.totalCount);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const params = new URLSearchParams(currentUrl.searchParams);
      params.set("page", String(publicResult.page + pagesLoaded + 1));
      const res = await fetch(`/api/problems?${params.toString()}`);
      if (!res.ok) return;
      const body = (await res.json()) as { problems: ProblemCard[] };
      if (body.problems.length === 0) {
        exhausted = true;
        return;
      }
      extra = [...extra, ...body.problems];
      pagesLoaded += 1;
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    const el = sentinel;
    if (!el) return;
    void allProblems.length;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  function clearFilters() {
    const params = new URLSearchParams(currentUrl.searchParams);
    for (const key of ["q", "difficulty", "status", "types", "judge", "tags", "page"]) {
      params.delete(key);
    }
    const qs = params.toString();
    void goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: true });
  }
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

    <section
      class="grid gap-4 sm:gap-x-8 {loggedIn
        ? 'sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto]'
        : 'sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]'}"
    >
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
      {:else if allProblems.length === 0}
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

      {#if allProblems.length > 0}
        <div
          class="hidden border border-transparent px-4 text-caption font-medium uppercase tracking-wide text-muted-foreground sm:col-span-full sm:grid sm:grid-cols-subgrid sm:items-center"
        >
          <span>{m.problems_columnProblem()}</span>
          <span class="min-w-24 text-center">{m.problemDetail_problemTypeTitle()}</span>
          <span class="min-w-24 text-center">{m.problemDetail_judgeMethodTitle()}</span>
          <span class="min-w-20 text-center">{m.common_difficulty()}</span>
          <span class="min-w-16 text-center">{m.common_acceptance()}</span>
          {#if loggedIn}<span aria-hidden="true"></span>{/if}
        </div>
      {/if}

      {#each allProblems as problem, index (problem.id)}
        <Card.Root
          variant="surface"
          size="lg"
          interactive
          data-tour={index === 0 ? "first-problem" : undefined}
          style="animation-delay: {Math.min(index * 30, 300)}ms"
          class="relative grid gap-x-8 gap-y-3 px-4 py-3 motion-safe:animate-[fade-up_400ms_var(--ease-out-soft)_both] sm:col-span-full sm:grid-cols-subgrid sm:items-center"
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

    {#if hasMore}
      <div bind:this={sentinel} class="flex justify-center py-4">
        {#if loadingMore}
          <Loader2 class="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        {/if}
      </div>
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
