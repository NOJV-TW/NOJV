<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ChevronRight, Plus } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import FilterChips from "$lib/components/common/FilterChips.svelte";
  import { formatTimeRangeCompact } from "$lib/utils/datetime";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { assignments, counts, currentFilter, canCreate } = $derived(data);
  const courseId = $derived(page.params.courseId ?? "");

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

  const filterOptions = $derived.by(() => {
    const options: { value: string; label: string; count: number }[] = [
      { value: "all", label: m.courseAssignments_filterAll(), count: counts.all },
      { value: "open", label: m.courseAssignments_filterOpen(), count: counts.open },
      {
        value: "upcoming",
        label: m.courseAssignments_filterUpcoming(),
        count: counts.upcoming
      },
      { value: "closed", label: m.courseAssignments_filterClosed(), count: counts.closed }
    ];
    if (counts.draft !== null) {
      options.push({
        value: "draft",
        label: m.courseAssignments_filterDraft(),
        count: counts.draft
      });
    }
    return options;
  });

  function statusBadge(
    status: "draft" | "upcoming" | "open" | "closed"
  ): { variant: "default" | "info" | "muted"; label: string; dot: boolean } {
    switch (status) {
      case "open":
        return { variant: "default", label: m.courseAssignments_statusOpen(), dot: true };
      case "upcoming":
        return { variant: "info", label: m.courseAssignments_statusUpcoming(), dot: true };
      case "draft":
        return {
          variant: "muted",
          label: m.courseAssignments_statusDraftTaVisible(),
          dot: false
        };
      case "closed":
      default:
        return { variant: "muted", label: m.courseAssignments_statusClosed(), dot: false };
    }
  }

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
      if (hoursLeft <= 24) return m.courseAssignments_urgencyDueTonight();
      const daysLeft = Math.ceil(hoursLeft / 24);
      return m.courseAssignments_urgencyDaysLeft({ count: daysLeft });
    }
    if (status === "upcoming" && opensAt) {
      const msUntil = new Date(opensAt).getTime() - now;
      if (msUntil <= 0) return null;
      const daysUntil = Math.ceil(msUntil / (24 * 60 * 60 * 1000));
      return m.courseAssignments_urgencyOpensIn({ count: daysUntil });
    }
    return null;
  }
</script>

<div class="space-y-6 pb-20">
  <!-- Filter chips + create button -->
  <div class="animate-in animate-in-1 flex flex-wrap items-center gap-4">
    <div class="flex-1">
      <FilterChips
        ariaLabel={m.courseAssignments_filtersLabel()}
        value={currentFilter}
        onChange={setFilter}
        options={filterOptions}
      />
    </div>
    {#if canCreate}
      <Button href={`/courses/${courseId}/assignments/new`}>
        <Plus class="h-4 w-4" />
        {m.courseAssignments_createNew()}
      </Button>
    {/if}
  </div>

  <!-- Rows -->
  {#if assignments.length === 0}
    <div
      class="animate-in animate-in-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {m.courseAssignments_empty()}
    </div>
  {:else}
    <div class="animate-in animate-in-2 grid gap-3">
      {#each assignments as assignment (assignment.id)}
        {@const badge = statusBadge(assignment.status)}
        {@const hint = urgencyHint(assignment.status, assignment.opensAt, assignment.closesAt)}
        <a
          href={`/assignments/${assignment.id}`}
          class="group relative grid grid-cols-[1fr_auto] items-center gap-6 rounded-2xl border bg-[color:var(--color-panel)] px-6 py-5 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-fast ease-out-soft hover:translate-x-[3px] hover:border-border-strong hover:shadow-rest {assignment.status ===
          'draft'
            ? 'border-dashed bg-transparent'
            : 'border-border'}"
        >
          <!-- Left border indicator (shows on hover; solid for draft) -->
          <span
            class="pointer-events-none absolute left-[-1px] top-[10px] bottom-[10px] w-[3px] rounded-full transition-colors duration-fast ease-out-soft {assignment.status ===
            'draft'
              ? 'bg-muted-foreground'
              : 'bg-transparent group-hover:bg-primary'}"
            aria-hidden="true"
          ></span>

          <div class="min-w-0">
            <h3 class="text-body-lg font-semibold tracking-[-0.01em]">{assignment.title}</h3>
            <div
              class="mt-2 flex items-center gap-2.5 font-mono text-caption text-muted-foreground tabular-nums"
            >
              {#if assignment.opensAt && assignment.closesAt}
                <span>{formatTimeRangeCompact(assignment.opensAt, assignment.closesAt)}</span>
              {:else}
                <span class="opacity-60">{m.courseAssignments_draftNoSchedule()}</span>
              {/if}
            </div>
            <div class="mt-2 flex items-center gap-3 text-caption text-muted-foreground">
              <span>{m.courseAssignments_problemCount({ count: assignment.problemCount })}</span>
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
              {#if assignment.status === "draft"}
                <span
                  class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <span class="font-medium text-primary"
                  >{m.courseAssignments_draftPublishHint()}</span
                >
              {/if}
            </div>
          </div>

          <div class="flex items-center gap-5">
            {#if canCreate}
              <!-- Teacher / TA view: class stats (approximation — see TODO in
                   domain layer. `classStats` is null today so we render em-dash
                   with a status-aware hint. Matches the prototype 04 layout. -->
              <div
                class="text-right font-mono text-caption text-muted-foreground tabular-nums leading-[1.4]"
              >
                <span
                  class="block font-display text-title-sm font-medium text-foreground"
                >
                  —
                </span>
                {#if assignment.status === "draft"}
                  {m.courseAssignments_classStatsDraftHint()}
                {:else if assignment.status === "upcoming"}
                  {m.courseAssignments_classStatsUpcomingHint()}
                {:else}
                  {m.courseAssignments_classStatsPendingTeacher()}
                {/if}
              </div>
            {:else}
              <!-- Student view: progress ring (personal completion %) +
                   action button. `myStatus` is null today (see TODO in
                   domain layer) so we render the ring empty with a dash
                   label and a status-aware CTA. Matches prototype 04. -->
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
                  {m.courseAssignments_actionNotOpen()}
                </span>
              {/if}
            {/if}
            <ChevronRight
              class="h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
