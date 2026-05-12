<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ClipboardList } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { buttonVariants } from "$lib/components/ui/button";
  import PageContainer from "$lib/components/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/layout/PageHeader.svelte";
  import TabStrip from "$lib/components/coursework/TabStrip.svelte";
  import AssignmentCard from "$lib/components/course/assignment/AssignmentCard.svelte";
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
      noScroll: true
    });
  }

  const tabs = $derived([
    { value: "all", label: m.assignmentsList_tabAll({ count: counts.all }) },
    { value: "open", label: m.assignmentsList_tabOpen({ count: counts.open }) },
    { value: "upcoming", label: m.assignmentsList_tabUpcoming({ count: counts.upcoming }) },
    { value: "closed", label: m.assignmentsList_tabClosed({ count: counts.closed }) }
  ]);
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

    <div class="flex flex-wrap items-center gap-3">
      <TabStrip {tabs} active={currentFilter} onChange={setTab} />
      <div class="ml-auto text-caption text-muted-foreground font-mono">{m.assignmentsList_sortByDue()}</div>
    </div>

    {#if assignments.length === 0}
      <div
        class="glass rounded-2xl px-8 py-16 text-center"
      >
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
    {:else}
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {#each assignments as assignment, i (assignment.id)}
          <AssignmentCard {assignment} delay={i * 60} />
        {/each}
      </div>
    {/if}
  </div>
</PageContainer>
