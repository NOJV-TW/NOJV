<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ClipboardList } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { buttonVariants } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import AssignmentCard from "$lib/components/features/course/assignment/AssignmentCard.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { assignments, counts, currentFilter } = $derived(data);

  function setTab(next: string) {
    const url = new URL(page.url);
    if (next === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    void goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true,
    });
  }

  const tabs = $derived([
    { key: "all", label: m.assignmentsList_tabAll(), count: counts.all },
    { key: "open", label: m.assignmentsList_tabOpen(), count: counts.open },
    { key: "upcoming", label: m.assignmentsList_tabUpcoming(), count: counts.upcoming },
    { key: "closed", label: m.assignmentsList_tabClosed(), count: counts.closed },
  ]);

  // On the "all" tab, split into ended-vs-not sections like the contests page.
  const groups = $derived(
    currentFilter !== "all"
      ? []
      : [
          {
            key: "open",
            label: m.assignmentsList_tabOpen(),
            items: assignments.filter((a) => a.status === "open"),
          },
          {
            key: "upcoming",
            label: m.assignmentsList_tabUpcoming(),
            items: assignments.filter((a) => a.status === "upcoming" || a.status === "draft"),
          },
          {
            key: "closed",
            label: m.assignmentsList_tabClosed(),
            items: assignments.filter((a) => a.status === "closed"),
          },
        ].filter((g) => g.items.length > 0),
  );
</script>

<PageContainer>
  <div class="space-y-6 fade-up">
    <PageHeader
      eyebrow={m.assignmentsList_eyebrow()}
      title={m.assignmentsList_heroTitle()}
      description={m.assignmentsList_heroDescription()}
    >
      {#snippet icon()}
        <ClipboardList class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
      {/snippet}
    </PageHeader>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle">
      <div
        role="tablist"
        aria-label={m.assignmentsList_heroTitle()}
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {#each tabs as tab (tab.key)}
          {@const isActive = tab.key === currentFilter}
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            onclick={() => setTab(tab.key)}
            class="-mb-px inline-flex items-center gap-2 border-b-2 px-5 py-3.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft {isActive
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'}"
          >
            <span>{tab.label}</span>
            <span
              class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums {isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'}"
            >
              {tab.count}
            </span>
          </button>
        {/each}
      </div>
      <div class="text-caption text-muted-foreground font-mono">
        {m.assignmentsList_sortByDue()}
      </div>
    </div>

    {#if assignments.length === 0}
      <div class="glass rounded-xl px-8 py-16 text-center">
        <ClipboardList
          class="mx-auto h-12 w-12 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <h2 class="mt-3 text-title font-medium">{m.assignmentsList_emptyTitle()}</h2>
        <p class="mt-2 text-body-sm text-muted-foreground">
          {m.assignmentsList_emptyHint()}
        </p>
        <a
          href="/courses"
          class={buttonVariants({ variant: "outline", size: "sm" }) + " mt-4 inline-flex"}
        >
          {m.assignmentsList_browseCourses()}
        </a>
      </div>
    {:else if currentFilter === "all"}
      <div class="space-y-8">
        {#each groups as g (g.key)}
          <section>
            <div class="mb-4 flex items-end gap-3">
              <span class="text-body font-semibold">{g.label}</span>
              <span class="text-caption text-muted-foreground tabular-nums"
                >{g.items.length}</span
              >
              <div class="ml-1 flex-1 border-t border-border-subtle"></div>
            </div>
            <div class="grid gap-2">
              {#each g.items as assignment, i (assignment.id)}
                <AssignmentCard {assignment} delay={i * 60} />
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <div class="grid gap-2">
        {#each assignments as assignment, i (assignment.id)}
          <AssignmentCard {assignment} delay={i * 60} />
        {/each}
      </div>
    {/if}
  </div>
</PageContainer>
