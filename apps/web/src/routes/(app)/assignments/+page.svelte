<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ChevronRight, ClipboardList } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { buttonVariants } from "$lib/components/ui/button";
  import FilterChips from "$lib/components/common/FilterChips.svelte";
  import { formatTimeRangeCompact } from "$lib/utils/datetime";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { assignments, counts, currentFilter, hasNoCourses } = $derived(data);

  function setFilter(next: string) {
    const url = new URL(page.url);
    if (next === "all") url.searchParams.delete("status");
    else url.searchParams.set("status", next);
    goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true
    });
  }

  const filterOptions = $derived([
    { value: "all", label: m.assignmentsTop_filterAll(), count: counts.all },
    { value: "open", label: m.assignmentsTop_filterOpen(), count: counts.open },
    {
      value: "upcoming",
      label: m.assignmentsTop_filterUpcoming(),
      count: counts.upcoming
    },
    { value: "closed", label: m.assignmentsTop_filterClosed(), count: counts.closed }
  ]);

  function statusBadge(
    status: "draft" | "upcoming" | "open" | "closed"
  ): { variant: "default" | "info" | "muted"; label: string; dot: boolean } {
    switch (status) {
      case "open":
        return { variant: "default", label: m.assignmentsTop_filterOpen(), dot: true };
      case "upcoming":
        return { variant: "info", label: m.assignmentsTop_filterUpcoming(), dot: true };
      case "closed":
        return { variant: "muted", label: m.assignmentsTop_closed(), dot: false };
      case "draft":
      default:
        // Drafts leak into the `all` slice for managers — render with
        // a muted badge so they're visually deprioritised.
        return { variant: "muted", label: m.assignmentsTop_filterAll(), dot: false };
    }
  }

  /**
   * Urgency hint rendered in the meta row. Same pattern as the per-
   * course assignments page but phrased from a cross-course POV.
   */
  function urgencyHint(
    status: "draft" | "upcoming" | "open" | "closed",
    opensAt: string | null,
    closesAt: string | null
  ): string | null {
    const now = Date.now();
    if (status === "open" && closesAt) {
      const msLeft = new Date(closesAt).getTime() - now;
      if (msLeft <= 0) return null;
      const hoursLeft = msLeft / (60 * 60 * 1000);
      if (hoursLeft <= 24) return m.assignmentsTop_dueToday();
      const daysLeft = Math.ceil(hoursLeft / 24);
      return m.assignmentsTop_dueSoon({ days: daysLeft });
    }
    return null;
  }
</script>

<div class="pb-24">
  <!-- Page head -->
  <header class="animate-in mb-8">
    <p class="text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {m.assignmentsTop_eyebrow()}
    </p>
    <h1 class="font-display mt-2 text-display-sm font-semibold tracking-[-0.02em]">
      {m.assignmentsTop_title()}
    </h1>
    <p class="mt-2 text-body text-muted-foreground">
      {m.assignmentsTop_subtitle()}
    </p>
  </header>

  {#if hasNoCourses}
    <!-- Empty state: user has no courses at all -->
    <div
      class="animate-in animate-in-1 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center"
    >
      <ClipboardList
        class="mx-auto h-12 w-12 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h2 class="font-display mt-3 text-title font-medium">
        {m.assignmentsTop_empty()}
      </h2>
      <p class="mt-2 text-body-sm text-muted-foreground">
        {m.assignmentsTop_emptyDescription()}
      </p>
      <a
        href="/courses"
        class={buttonVariants({ variant: "outline", size: "sm" }) + " mt-4 inline-flex"}
      >
        {m.assignmentsTop_backToCourses()}
      </a>
    </div>
  {:else}
    <!-- Filter chips + sort hint -->
    <div class="animate-in animate-in-1 mb-6 flex flex-wrap items-center gap-4">
      <div class="flex-1">
        <FilterChips
          value={currentFilter}
          onChange={setFilter}
          options={filterOptions}
        />
      </div>
      <p class="text-caption text-muted-foreground">{m.assignmentsTop_sortHint()}</p>
    </div>

    {#if assignments.length === 0}
      <div
        class="animate-in animate-in-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
      >
        {m.assignmentsTop_empty()}
      </div>
    {:else}
      <div class="animate-in animate-in-2 grid gap-3">
        {#each assignments as assignment (assignment.id)}
          {@const badge = statusBadge(assignment.status)}
          {@const hint = urgencyHint(
            assignment.status,
            assignment.opensAt,
            assignment.closesAt
          )}
          <a
            href={`/courses/${assignment.courseId}/assignments/${assignment.id}`}
            class="group relative grid grid-cols-[1fr_auto] items-center gap-6 rounded-2xl border bg-[color:var(--color-panel)] px-6 py-5 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-fast ease-out-soft hover:translate-x-[3px] hover:border-border-strong hover:shadow-rest {assignment.status ===
            'draft'
              ? 'border-dashed bg-transparent'
              : 'border-border'}"
          >
            <!-- Left accent bar on hover -->
            <span
              class="pointer-events-none absolute left-[-1px] top-[10px] bottom-[10px] w-[3px] rounded-full bg-transparent transition-colors duration-fast ease-out-soft group-hover:bg-primary"
              aria-hidden="true"
            ></span>

            <div class="min-w-0">
              <!-- Course tag — rendered as a static span (not a nested
                   link) because the parent row is already an anchor.
                   Mirrors the CourseTagPill visual from Task 3.1. -->
              <span
                class="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--color-panel)] px-2.5 py-1 text-caption font-medium text-muted-foreground"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden="true"
                ></span>
                <span class="truncate">{assignment.courseTitle}</span>
              </span>
              <h3 class="mt-1 text-body-lg font-semibold tracking-[-0.01em]">
                {assignment.title}
              </h3>
              <div
                class="mt-2 flex items-center gap-2.5 font-mono text-caption text-muted-foreground tabular-nums"
              >
                {#if assignment.opensAt && assignment.closesAt}
                  <span>{formatTimeRangeCompact(assignment.opensAt, assignment.closesAt)}</span>
                {/if}
              </div>
              <div
                class="mt-2 flex flex-wrap items-center gap-3 text-caption text-muted-foreground"
              >
                <span>{assignment.problemCount}</span>
                <span
                  class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant={badge.variant} dot={badge.dot} size="sm">{badge.label}</Badge>
                {#if hint}
                  <span
                    class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                    aria-hidden="true"
                  ></span>
                  <span>{hint}</span>
                {/if}
              </div>
            </div>

            <div class="flex items-center gap-5">
              <!-- Progress ring (personal completion %). `myStatus` is
                   null today — see TODO in the domain layer — so we
                   render the ring empty with a dash label. -->
              <div
                class="relative flex h-11 w-11 items-center justify-center rounded-full"
                style="background: conic-gradient(var(--color-primary) 0%, var(--color-border) 0);"
                aria-hidden="true"
              >
                <span
                  class="absolute inset-[4px] rounded-full bg-[color:var(--color-panel)]"
                ></span>
                <span class="relative text-caption font-semibold tabular-nums">—</span>
              </div>
              {#if assignment.status === "open"}
                <span class={buttonVariants({ variant: "default", size: "sm" })}>
                  {m.courseAssignments_actionContinue()}
                  <ChevronRight class="h-4 w-4" />
                </span>
              {:else if assignment.status === "closed"}
                <span class={buttonVariants({ variant: "outline", size: "sm" })}>
                  {m.courseAssignments_actionViewResults()}
                </span>
              {:else}
                <span
                  class={buttonVariants({ variant: "outline", size: "sm" })}
                  aria-disabled="true"
                  style="opacity: 0.5; cursor: not-allowed;"
                >
                  {m.assignmentsTop_notDue()}
                </span>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</div>
