<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    ArrowDownNarrowWide,
    ArrowUpNarrowWide,
    FileCode,
    Pencil,
    RotateCcw,
    Search,
    Tags,
    Trash2,
  } from "@lucide/svelte";
  import { Button, LinkButton } from "$lib/components/primitives/ui/button";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import type { ProblemDifficulty, ProblemType, ProblemVisibility } from "@nojv/core";
  import { difficultyClass, tagClass } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";
  import {
    difficulties,
    filterProblems,
    renderJudgeMethod,
    renderProblemType,
    type Difficulty,
  } from "../problem-display";

  export interface EditableProblemCard {
    difficulty: ProblemDifficulty;
    displayId: number | null;
    id: string;
    judgeType: string;
    type: ProblemType;
    status: string;
    tags: string[];
    title: string;
    visibility: ProblemVisibility;
  }

  interface Props {
    editableProblems: EditableProblemCard[];
    deletingProblemId: string | null;
    isDeleting: boolean;
    onDeleteClick: (problemId: string) => void;
  }

  let { editableProblems, deletingProblemId, isDeleting, onDeleteClick }: Props = $props();

  let currentUrl = $derived(page.url);
  let sortDirection = $derived<"asc" | "desc">(
    currentUrl.searchParams.get("sort") === "desc" ? "desc" : "asc",
  );

  let mineSearch = $state("");
  let mineDifficulty = $state<Difficulty>("all");
  let mineSelectedTags = $state<Set<string>>(new Set());
  let showMineCardTags = $state(false);
  let rejudgeProblemId = $state<string | null>(null);

  let mineAllTags = $derived([...new Set(editableProblems.flatMap((p) => p.tags))].sort());

  let mineFiltered = $derived(
    filterProblems(editableProblems, mineSearch, mineDifficulty, mineSelectedTags),
  );

  function toggleSort() {
    const params = new URLSearchParams(currentUrl.searchParams);
    if (sortDirection === "asc") params.set("sort", "desc");
    else params.delete("sort");
    const qs = params.toString();
    goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: true });
  }

  function toggleMineTag(tag: string) {
    const next = new Set(mineSelectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    mineSelectedTags = next;
  }

  function clearMineFilters() {
    mineSearch = "";
    mineDifficulty = "all";
    mineSelectedTags = new Set();
  }

  function closeRejudgeDialog(open: boolean) {
    if (!open) rejudgeProblemId = null;
  }
</script>

<div class="flex flex-col gap-3">
  <div class="relative">
    <Search
      class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <Input
      class="pl-9 rounded-full"
      oninput={(e) => {
        mineSearch = (e.target as HTMLInputElement).value;
      }}
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
        class="inline-flex items-center justify-center rounded-full border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft pointer-coarse:min-h-11 {mineDifficulty ===
        d
          ? 'border-foreground bg-foreground text-background'
          : 'border-border hover:bg-[color:var(--color-panel)]'}"
        onclick={() => {
          mineDifficulty = d;
        }}
        type="button"
      >
        {d === "all" ? m.problems_allDifficulties() : d.charAt(0).toUpperCase() + d.slice(1)}
      </button>
    {/each}
    <button
      class="ml-auto inline-flex items-center justify-center rounded-full border border-border bg-[color:var(--color-panel)] p-1.5 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-accent hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
      class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-caption font-semibold text-primary transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:bg-primary/15 pointer-coarse:min-h-11"
      aria-pressed={showMineCardTags}
      onclick={() => {
        showMineCardTags = !showMineCardTags;
      }}
      type="button"
    >
      <Tags aria-hidden="true" class="size-3.5" />
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
          class="inline-flex items-center justify-center rounded-full border px-3 py-1 text-caption font-medium transition-[transform,box-shadow,background-color] duration-fast ease-out-soft pointer-coarse:min-h-11 {mineSelectedTags.has(
            tag,
          )
            ? 'border-primary bg-primary/10 text-foreground'
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
  {#if editableProblems.length === 0}
    <EmptyState icon={FileCode} title={m.problems_myProblemsEmpty()} />
  {:else if mineFiltered.length === 0}
    <div class="flex flex-col items-center gap-4 py-16">
      <EmptyState icon={Search} variant="minimal" title={m.problems_noResults()} class="py-0" />
      <Button variant="outline" size="sm" onclick={clearMineFilters}>
        {m.problems_clearFilters()}
      </Button>
    </div>
  {/if}
  {#each mineFiltered as problem (problem.id)}
    {@const titleHref =
      problem.status === "published"
        ? `/problems/${problem.id}`
        : `/problems/${problem.id}/edit`}
    <Card
      variant="surface"
      size="lg"
      class="grid gap-x-8 gap-y-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] sm:items-center"
    >
      <div class="min-w-0">
        <a
          href={titleHref}
          class="transition-[opacity] duration-fast ease-out-soft hover:opacity-80"
        >
          <h3 class="text-title font-semibold">{formatProblemDisplayName(problem)}</h3>
        </a>
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
          class="mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold capitalize {difficultyClass(
            problem.difficulty,
          )}"
        >
          {problem.difficulty}
        </span>
      </div>
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
        {#if problem.status !== "draft"}
          <Button variant="outline" size="sm" onclick={() => (rejudgeProblemId = problem.id)}>
            <RotateCcw class="size-3" aria-hidden="true" />
            {m.rejudge_problem_admin_button()}
          </Button>
        {/if}
        <LinkButton href={`/problems/${problem.id}/edit`} variant="outline" size="sm">
          <Pencil class="size-3" aria-hidden="true" />
          {m.problemDetail_editProblem()}
        </LinkButton>
        {#if problem.status === "draft"}
          <Button
            variant="destructive"
            size="sm"
            disabled={isDeleting && deletingProblemId === problem.id}
            onclick={() => onDeleteClick(problem.id)}
          >
            <Trash2 class="size-3" aria-hidden="true" />
            {m.common_delete()}
          </Button>
        {/if}
      </div>
    </Card>
  {/each}
</section>

{#if rejudgeProblemId}
  <RejudgeDialog
    problemId={rejudgeProblemId}
    open={true}
    scope={{ type: "practice" }}
    onOpenChange={closeRejudgeDialog}
  />
{/if}
