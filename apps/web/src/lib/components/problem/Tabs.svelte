<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/stores";
  import type { ProblemDifficulty, ProblemVisibility } from "@nojv/core";
  import { CheckCircle2, ChevronDown, FileCode, Pencil, Plus, Search, Tags, Trash2, XCircle } from "@lucide/svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import SpecialLabels from "$lib/components/problem/SpecialLabels.svelte";
  import { Button, LinkButton } from "$lib/components/ui/button";
  import { Badge, type BadgeVariant } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import type { problemDomain } from "@nojv/domain";
  type ProblemListResult = problemDomain.ProblemListResult;

  let creating = $state(false);
  let showCreateMenu = $state(false);

  async function handleCreate(mode: "standard" | "advanced" = "standard") {
    creating = true;
    showCreateMenu = false;
    try {
      const res = await fetch("/api/problems/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      if (!res.ok) throw new Error("Failed to create problem");
      const body = (await res.json()) as { id: string; mode: "standard" | "advanced" };
      const targetPath = body.mode === "advanced"
        ? `/problems/${body.id}/edit-advanced`
        : `/problems/${body.id}/edit`;
      await goto(targetPath);
    } finally {
      creating = false;
    }
  }

  function formatAcceptanceRate(value: number): string {
    return `${String(Math.round(value * 100))}%`;
  }

  const difficultyBadgeVariant: Record<string, BadgeVariant> = {
    easy: "success",
    medium: "warning",
    hard: "destructive"
  };

  interface EditableProblemCard {
    difficulty: ProblemDifficulty;
    id: string;
    judgeType: string;
    type: import("@nojv/core").ProblemType;
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
    const target = qs ? `?${qs}` : currentUrl.pathname;
    goto(target, { keepFocus: true, noScroll: true });
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

  let showDeleteConfirm = $state(false);
  let deletingProblemId = $state<string | null>(null);
  let deleting = $state(false);

  function handleDeleteClick(problemId: string) {
    deletingProblemId = problemId;
    showDeleteConfirm = true;
  }

  async function handleDeleteConfirmed() {
    if (!deletingProblemId) return;
    showDeleteConfirm = false;
    deleting = true;
    const fd = new FormData();
    await fetch(`/problems/${deletingProblemId}/edit?/deleteProblem`, { method: "POST", body: fd });
    deleting = false;
    deletingProblemId = null;
    await invalidateAll();
  }

  const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center gap-2">
    <button
      class="rounded-full border px-4 py-2 text-body-sm font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {tab === 'public'
        ? 'border-primary bg-primary text-white'
        : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
      onclick={() => setTab("public")}
      type="button"
    >
      {m.problems_publicLibrary()}
    </button>
    {#if showCreate}
      <button
        class="rounded-full border px-4 py-2 text-body-sm font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {tab === 'mine'
          ? 'border-primary bg-primary text-white'
          : 'border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
        onclick={() => setTab("mine")}
        type="button"
      >
        {m.problems_myProblems()}
      </button>
      <div class="relative ml-auto">
        <Button
          disabled={creating}
          loading={creating}
          onclick={() => { showCreateMenu = !showCreateMenu; }}
          class="rounded-full"
        >
          <Plus class="size-4" aria-hidden="true" />
          {creating ? m.common_saving() : m.problems_createNew()}
          <ChevronDown class="size-3 opacity-70" aria-hidden="true" />
        </Button>
        {#if showCreateMenu}
          <div
            class="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-border bg-[color:var(--color-panel)] p-2 shadow-hover"
            role="menu"
          >
            <button
              class="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
              onclick={() => void handleCreate("standard")}
              type="button"
            >
              <span class="font-semibold">{m.problems_createStandardTitle()}</span>
              <span class="text-caption text-muted-foreground">
                {m.problems_createStandardDescription()}
              </span>
            </button>
            <button
              class="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-body-sm transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
              onclick={() => void handleCreate("advanced")}
              type="button"
            >
              <span class="font-semibold">{m.problems_createAdvancedTitle()}</span>
              <span class="text-caption text-muted-foreground">
                {m.problems_createAdvancedDescription()}
              </span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if tab === "public"}
    <!-- Public tab: filter bar (URL-driven) -->
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
          class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-caption font-semibold text-primary transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-primary/15"
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
            class="grid gap-4 sm:grid-cols-[auto_1.4fr_auto_auto_auto_auto] sm:items-center"
          >
            <div class="flex w-6 items-center justify-center">
              {#if problem.status === "ac"}
                <CheckCircle2 class="size-5 text-success" aria-label={m.problems_statusAc()} />
              {:else if problem.status === "attempted"}
                <XCircle class="size-5 text-warning" aria-label={m.problems_statusAttempted()} />
              {/if}
            </div>
            <div>
              <h3 class="text-title font-semibold">{problem.title}</h3>
              {#if showPublicCardTags && problem.tags.length > 0}
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  {#each problem.tags as tag (tag)}
                    <Badge variant="muted" size="sm">{tag}</Badge>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="sm:text-center">
              <SpecialLabels
                problemType={problem.type}
                judgeType={problem.judgeType}
                compact
                which="problem-type"
              />
            </div>
            <div class="sm:text-center">
              <SpecialLabels
                problemType={problem.type}
                judgeType={problem.judgeType}
                compact
                which="judge-method"
              />
            </div>
            <Badge
              variant={difficultyBadgeVariant[problem.difficulty] ?? "muted"}
              size="md"
              class="self-center capitalize"
              aria-label={`${m.common_difficulty()}: ${problem.difficulty}`}
            >
              {problem.difficulty}
            </Badge>
            <div class="sm:text-right">
              <p class="text-body-sm text-muted-foreground">{m.common_acceptance()}</p>
              <p class="mt-1 text-body-lg font-semibold tabular-nums">
                {formatAcceptanceRate(problem.acceptanceRate)}
              </p>
            </div>
          </Card.Root>
        </a>
      {/each}
    </section>

    <!-- Pagination -->
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
  {/if}

  {#if tab === "mine" && showCreate}
    <!-- Mine tab: filter bar (client-side) -->
    <div class="flex flex-col gap-3">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          class="pl-9 rounded-full"
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
        <span class="text-caption font-medium text-muted-foreground">
          {m.common_difficulty()}:
        </span>
        {#each difficulties as d (d)}
          <button
            class="rounded-full border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {mineDifficulty ===
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
          class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-caption font-semibold text-primary transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-primary/15"
          aria-pressed={showMineCardTags}
          onclick={() => { showMineCardTags = !showMineCardTags; }}
          type="button"
        >
          <Tags class="size-3.5" />
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
              class="rounded-full border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft {mineSelectedTags.has(
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
          variant="minimal"
          title={m.problems_noResults()}
        />
      {/if}
      {#each mineFiltered as problem (problem.id)}
        <Card.Root
          variant="surface"
          size="lg"
          class="grid gap-4 sm:grid-cols-[1.4fr_auto_auto_auto_auto_auto] sm:items-center"
        >
          <div>
            <a href="/problems/{problem.id}" class="transition-[opacity] duration-fast ease-out-soft hover:opacity-80">
              <h3 class="text-title font-semibold">{problem.title}</h3>
            </a>
            {#if showMineCardTags && problem.tags.length > 0}
              <div class="mt-1 flex flex-wrap items-center gap-1.5">
                {#each problem.tags as tag (tag)}
                  <Badge variant="muted" size="sm">{tag}</Badge>
                {/each}
              </div>
            {/if}
          </div>
          <div class="sm:text-center">
            <SpecialLabels
              problemType={problem.type}
              judgeType={problem.judgeType}
              compact
              which="problem-type"
            />
          </div>
          <div class="sm:text-center">
            <SpecialLabels
              problemType={problem.type}
              judgeType={problem.judgeType}
              compact
              which="judge-method"
            />
          </div>
          <Badge
            variant={difficultyBadgeVariant[problem.difficulty] ?? "muted"}
            size="md"
            class="self-center capitalize"
            aria-label={`${m.common_difficulty()}: ${problem.difficulty}`}
          >
            {problem.difficulty}
          </Badge>
          <div class="flex flex-wrap gap-1.5 sm:justify-end">
            {#if problem.status === "draft"}
              <Badge variant="warning" size="md">
                {m.problems_statusDraft()}
              </Badge>
            {/if}
            <Badge
              variant={problem.visibility === "public" ? "success" : "muted"}
              size="md"
              class="capitalize"
            >
              {problem.visibility}
            </Badge>
          </div>
          <div class="flex items-center gap-2">
            <LinkButton href="/problems/{problem.id}/edit" variant="outline" size="sm">
              <Pencil class="size-3" aria-hidden="true" />
              {m.problemDetail_editProblem()}
            </LinkButton>
            {#if problem.status === "draft"}
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting && deletingProblemId === problem.id}
                onclick={() => handleDeleteClick(problem.id)}
              >
                <Trash2 class="size-3" aria-hidden="true" />
                {m.common_delete()}
              </Button>
            {/if}
          </div>
        </Card.Root>
      {/each}
    </section>
  {/if}
</div>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title={m.admin_deleteProblemTitle()}
  message={m.admin_deleteProblemMessage()}
  confirmText={m.common_delete()}
  cancelText={m.admin_cancel()}
  variant="danger"
  onconfirm={handleDeleteConfirmed}
  oncancel={() => { showDeleteConfirm = false; deletingProblemId = null; }}
/>
