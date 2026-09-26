<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ClipboardList } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { buttonVariants } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import FilterTabs from "$lib/components/primitives/visual/FilterTabs.svelte";
  import AssignmentCard from "$lib/components/features/course/assignment/AssignmentCard.svelte";
  import AssessmentGroupHeading from "$lib/components/features/coursework/AssessmentGroupHeading.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { assignments, currentFilter } = $derived(data);

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
    { key: "all", label: m.assignmentsList_tabAll() },
    { key: "open", label: m.assignmentsList_tabOpen() },
    { key: "upcoming", label: m.assignmentsList_tabUpcoming() },
    { key: "closed", label: m.assignmentsList_tabClosed() },
  ]);

  const groups = $derived(
    currentFilter !== "all"
      ? []
      : (
          [
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
          ] as const
        ).filter((g) => g.items.length > 0),
  );
</script>

<PageContainer>
  <div class="space-y-6 fade-up">
    <PageHeader title={m.assignmentsList_heroTitle()} />

    <FilterTabs
      {tabs}
      value={currentFilter}
      label={m.assignmentsList_heroTitle()}
      onSelect={setTab}
    >
      <div class="text-caption text-muted-foreground font-mono">
        {m.assignmentsList_sortByDue()}
      </div>
    </FilterTabs>

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
            <AssessmentGroupHeading label={g.label} status={g.key} />
            <div class="grid gap-2">
              {#each g.items as assignment, i (assignment.id)}
                <AssignmentCard {assignment} showStatusIcon={false} delay={i * 60} />
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
