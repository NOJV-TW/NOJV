<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ClipboardList, FileCheck } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { buttonVariants } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import ExamRow from "$lib/components/features/course/exam/ExamRow.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { exams, counts, currentFilter } = $derived(data);

  function setTab(next: string) {
    const url = new URL(page.url);
    if (next === "all") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true,
    });
  }

  const sorted = $derived(
    [...exams].sort((a, b) => {
      const order = { running: 0, upcoming: 1, ended: 2 } as const;
      const oa = order[a.status];
      const ob = order[b.status];
      if (oa !== ob) return oa - ob;
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    }),
  );

  const tabs = $derived([
    { key: "all", label: m.examsTop_filterAll(), count: counts.all },
    { key: "running", label: m.examsTop_filterRunning(), count: counts.running },
    { key: "upcoming", label: m.examsTop_filterUpcoming(), count: counts.upcoming },
    { key: "ended", label: m.examsTop_filterEnded(), count: counts.ended },
  ]);
</script>

<PageContainer>
  <div class="space-y-6 fade-up">
    <PageHeader
      eyebrow={m.examsTop_eyebrow()}
      title={m.navigation_exams()}
      description={m.examsTop_subtitle()}
    >
      {#snippet icon()}
        <FileCheck class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
      {/snippet}
    </PageHeader>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle">
      <div
        role="tablist"
        aria-label={m.navigation_exams()}
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
    </div>

    {#if sorted.length === 0}
      <div
        class="glass rounded-xl border border-dashed border-border-strong px-8 py-12 text-center"
      >
        <ClipboardList
          class="mx-auto h-12 w-12 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <h2 class="mt-3 text-title font-medium">
          {m.examsTop_empty()}
        </h2>
        <p class="mt-2 text-body-sm text-muted-foreground">
          {m.examsTop_emptyDescription()}
        </p>
        <a
          href="/courses"
          class={buttonVariants({ variant: "outline", size: "sm" }) + " mt-4 inline-flex"}
        >
          {m.common_browseMyCourses()}
        </a>
      </div>
    {:else}
      <div class="grid gap-2">
        {#each sorted as exam, i (exam.id)}
          <ExamRow {exam} delay={i * 80} />
        {/each}
      </div>
    {/if}
  </div>
</PageContainer>
