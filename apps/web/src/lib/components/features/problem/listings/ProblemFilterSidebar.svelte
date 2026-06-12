<script lang="ts">
  import {
    ArrowDownNarrowWide,
    ArrowUpNarrowWide,
    Check,
    RotateCcw,
    Search,
  } from "@lucide/svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import { problemTypes, judgeTypes } from "@nojv/core";
  import type { problemDomain } from "@nojv/domain";
  import { Input } from "$lib/components/primitives/ui/input";
  import FilterChips, {
    type FilterChipOption,
  } from "$lib/components/primitives/ui/FilterChips.svelte";
  import { cn } from "$lib/utils/css.js";
  import { difficulties, renderProblemType, renderJudgeMethod } from "../problem-display";

  interface Props {
    publicResult: problemDomain.ProblemListResult;
    loggedIn: boolean;
  }

  let { publicResult, loggedIn }: Props = $props();

  let currentUrl = $derived(page.url);
  let search = $derived(currentUrl.searchParams.get("q") ?? "");
  let difficulty = $derived(currentUrl.searchParams.get("difficulty") || "all");
  let status = $derived(currentUrl.searchParams.get("status") ?? "all");
  let selectedTypes = $derived(
    new Set((currentUrl.searchParams.get("types") ?? "").split(",").filter(Boolean)),
  );
  let selectedJudge = $derived(
    new Set((currentUrl.searchParams.get("judge") ?? "").split(",").filter(Boolean)),
  );
  let selectedTags = $derived(
    new Set((currentUrl.searchParams.get("tags") ?? "").split(",").filter(Boolean)),
  );
  let sortDirection = $derived(currentUrl.searchParams.get("sort") === "desc" ? "desc" : "asc");

  let allTags = $derived(
    [...new Set([...publicResult.problems.flatMap((p) => p.tags), ...selectedTags])].sort(),
  );

  let counts = $derived(publicResult.statusCounts);
  let hasActiveFilters = $derived(
    [...currentUrl.searchParams.keys()].some((k) =>
      ["q", "difficulty", "status", "types", "judge", "tags"].includes(k),
    ),
  );

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchValue = $state("");
  $effect(() => {
    searchValue = search;
  });

  function updateUrl(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(currentUrl.searchParams);
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined || val === "" || val === "all") params.delete(key);
      else params.set(key, val);
    }
    params.delete("page");
    const qs = params.toString();
    void goto(qs ? `?${qs}` : "?", { keepFocus: true, noScroll: true });
  }

  function toggleInSet(current: Set<string>, value: string, key: string) {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updateUrl({ [key]: [...next].join(",") || undefined });
  }

  function handleSearch(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchValue = val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => updateUrl({ q: val || undefined }), 300);
  }

  function reset() {
    void goto("?", { keepFocus: true, noScroll: true });
  }

  let statusOptions = $derived<FilterChipOption[]>([
    { value: "all", label: m.problems_statusAll(), count: counts?.all },
    { value: "solved", label: m.problems_statusAc(), count: counts?.solved },
    { value: "attempted", label: m.problems_statusAttempted(), count: counts?.attempted },
    { value: "untried", label: m.problems_statusUntried(), count: counts?.untried },
    { value: "bookmarked", label: m.problems_statusBookmarked(), count: counts?.bookmarked },
  ]);

  let difficultyOptions = $derived<FilterChipOption[]>(
    difficulties.map((d) => ({
      value: d,
      label:
        d === "all" ? m.problems_allDifficulties() : d.charAt(0).toUpperCase() + d.slice(1),
    })),
  );
</script>

{#snippet heading(text: string)}
  <p class="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
    {text}
  </p>
{/snippet}

{#snippet checkRow(checked: boolean, label: string, onclick: () => void)}
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    {onclick}
    class={cn(
      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-body-sm font-medium transition-[color,background-color,border-color] duration-fast ease-out-soft",
      checked
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border bg-[color:var(--color-panel)] text-muted-foreground hover:border-border-strong hover:text-foreground",
    )}
  >
    <span
      class={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
        checked ? "border-primary bg-primary text-white" : "border-border-strong",
      )}
    >
      {#if checked}<Check class="size-3" strokeWidth={3} aria-hidden="true" />{/if}
    </span>
    <span class="capitalize">{label}</span>
  </button>
{/snippet}

<div class="flex flex-col gap-6">
  <div class="relative">
    <Search
      class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <Input
      class="rounded-full pl-9"
      oninput={handleSearch}
      placeholder={m.problems_searchProblems()}
      type="text"
      value={searchValue}
    />
  </div>

  {#if loggedIn}
    <div>
      {@render heading(m.problems_filterStatus())}
      <FilterChips
        ariaLabel={m.problems_filterStatus()}
        options={statusOptions}
        value={status}
        onChange={(v) => updateUrl({ status: v === "all" ? undefined : v })}
      />
    </div>
  {/if}

  <div>
    {@render heading(m.common_difficulty())}
    <FilterChips
      ariaLabel={m.problems_filterByDifficulty()}
      options={difficultyOptions}
      value={difficulty}
      onChange={(v) => updateUrl({ difficulty: v })}
    />
  </div>

  <div>
    {@render heading(m.problems_filterProblemType())}
    <div class="flex flex-col gap-2">
      {#each problemTypes as t (t)}
        {@render checkRow(selectedTypes.has(t), renderProblemType(t), () =>
          toggleInSet(selectedTypes, t, "types"),
        )}
      {/each}
    </div>
  </div>

  <div>
    {@render heading(m.problems_filterJudgeMethod())}
    <div class="flex flex-col gap-2">
      {#each judgeTypes as jt (jt)}
        {@render checkRow(selectedJudge.has(jt), renderJudgeMethod("full_source", jt), () =>
          toggleInSet(selectedJudge, jt, "judge"),
        )}
      {/each}
    </div>
  </div>

  {#if allTags.length > 0}
    <div>
      {@render heading(m.problems_filterTags())}
      <div class="flex flex-wrap gap-2" role="group" aria-label={m.problems_filterByTag()}>
        {#each allTags as tag (tag)}
          <button
            type="button"
            aria-pressed={selectedTags.has(tag)}
            onclick={() => toggleInSet(selectedTags, tag, "tags")}
            class={cn(
              "rounded-full border px-3 py-1 text-caption font-medium capitalize transition-[color,background-color,border-color] duration-fast ease-out-soft",
              selectedTags.has(tag)
                ? "border-primary bg-primary text-white"
                : "border-border bg-[color:var(--color-panel)] text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {tag}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="flex items-center gap-2 border-t border-border-subtle pt-4">
    <button
      type="button"
      onclick={reset}
      disabled={!hasActiveFilters}
      class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2 text-body-sm font-medium text-foreground transition-[color,background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)] disabled:opacity-40"
    >
      <RotateCcw class="size-3.5" aria-hidden="true" />
      {m.problems_filterReset()}
    </button>
    <button
      type="button"
      onclick={() => updateUrl({ sort: sortDirection === "asc" ? "desc" : undefined })}
      aria-label={sortDirection === "asc" ? m.problems_sortAsc() : m.problems_sortDesc()}
      title={sortDirection === "asc" ? m.problems_sortAsc() : m.problems_sortDesc()}
      class="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2 text-body-sm font-medium text-muted-foreground transition-[color,background-color] duration-fast ease-out-soft hover:bg-[color:var(--color-panel)] hover:text-foreground"
    >
      {#if sortDirection === "asc"}
        <ArrowUpNarrowWide class="size-4" aria-hidden="true" />
      {:else}
        <ArrowDownNarrowWide class="size-4" aria-hidden="true" />
      {/if}
      ID
    </button>
  </div>
</div>
