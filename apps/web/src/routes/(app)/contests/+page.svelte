<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Plus, Trophy } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/primitives/ui/dialog/index.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import { Input } from "$lib/components/primitives/ui/input/index.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import ContestPoster from "$lib/components/features/contest/ContestPoster.svelte";
  import ContestRowPast from "$lib/components/features/contest/ContestRowPast.svelte";
  import { contestStatusFor, durationMinutes } from "$lib/components/features/contest/format";
  import { contestScoringLabel } from "$lib/utils/contest-scoring";

  let { data, form: actionData } = $props();

  let joinDialogOpen = $state(false);

  type Contest = (typeof data)["participable"][number];

  function decorate(c: Contest) {
    const status = contestStatusFor(c.startsAt, c.endsAt);
    return {
      raw: c,
      status,
      scoringLabel: contestScoringLabel(c.scoringMode),
      durationMin: durationMinutes(c.startsAt, c.endsAt),
    };
  }

  const all = $derived(
    [...data.participable, ...data.managed].map(decorate).sort((a, b) => {
      return new Date(b.raw.startsAt).getTime() - new Date(a.raw.startsAt).getTime();
    }),
  );

  const live = $derived(all.filter((x) => x.status === "live"));
  const upcoming = $derived(
    [...all]
      .filter((x) => x.status === "upcoming")
      .sort((a, b) => new Date(a.raw.startsAt).getTime() - new Date(b.raw.startsAt).getTime()),
  );
  const past = $derived(all.filter((x) => x.status === "ended"));

  const currentTab = $derived(page.url.searchParams.get("tab") ?? "all");

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
    { key: "all", label: m.contestsList_tabAll(), count: all.length },
    { key: "live", label: m.contestsList_tabLive(), count: live.length },
    { key: "upcoming", label: m.contestsList_tabUpcoming(), count: upcoming.length },
    { key: "ended", label: m.contestsList_tabEnded(), count: past.length },
  ]);

  const allGroups = $derived(
    [
      { key: "live", label: m.contestsList_tabLive(), items: live, past: false },
      { key: "upcoming", label: m.contestsList_tabUpcoming(), items: upcoming, past: false },
      { key: "ended", label: m.contestsList_tabEnded(), items: past, past: true },
    ].filter((g) => g.items.length > 0),
  );
</script>

<PageContainer>
  <div class="space-y-8 fade-up">
    <PageHeader
      eyebrow={m.contests_eyebrow()}
      title={m.contestsList_heroTitle()}
      description={m.contestsList_heroDescription()}
    >
      {#snippet icon()}
        <Trophy class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
      {/snippet}
    </PageHeader>

    {#snippet posterGrid(items: typeof all)}
      <div class="grid gap-2">
        {#each items as c, i (c.raw.id)}
          <ContestPoster
            href="/contests/{c.raw.id}"
            scoringLabel={c.scoringLabel}
            status={c.status}
            title={c.raw.title}
            summary={c.raw.summary}
            startsAt={c.raw.startsAt}
            endsAt={c.raw.endsAt}
            durationMin={c.durationMin}
            participants={c.raw.participantCount}
            delay={i * 80}
          />
        {/each}
      </div>
    {/snippet}

    {#snippet pastGrid(items: typeof all)}
      <div class="grid gap-2">
        {#each items as c, i (c.raw.id)}
          <ContestRowPast
            href="/contests/{c.raw.id}"
            scoringLabel={c.scoringLabel}
            title={c.raw.title}
            startsAt={c.raw.startsAt}
            participants={c.raw.participantCount}
            delay={i * 60}
          />
        {/each}
      </div>
    {/snippet}

    {#snippet emptyBox()}
      <div class="glass rounded-xl px-6 py-10 text-center text-body-sm text-muted-foreground">
        {m.contestsList_tabEmpty()}
      </div>
    {/snippet}

    {#snippet firstUseBox()}
      <div class="glass rounded-xl px-6 py-12 text-center">
        <p class="text-body font-semibold">{m.contestsList_emptyAllTitle()}</p>
        <p class="mt-1 text-body-sm text-muted-foreground">{m.contestsList_emptyAllBody()}</p>
        {#if data.loggedIn}
          <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onclick={() => (joinDialogOpen = true)}
            >
              {m.contestsList_joinByCode()}
            </Button>
            <Button href="/contests/new" size="sm">
              <Plus aria-hidden="true" class="h-4 w-4" />
              {m.contestsList_create()}
            </Button>
          </div>
        {/if}
      </div>
    {/snippet}

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle">
      <div
        role="tablist"
        aria-label={m.contestsList_heroTitle()}
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {#each tabs as tab (tab.key)}
          {@const isActive = tab.key === currentTab}
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
      {#if data.loggedIn}
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onclick={() => (joinDialogOpen = true)}
          >
            {m.contestsList_joinByCode()}
          </Button>
          <Button href="/contests/new" size="sm">
            <Plus aria-hidden="true" class="h-4 w-4" />
            {m.contestsList_create()}
          </Button>
        </div>
      {/if}
    </div>

    {#if currentTab === "all"}
      {#if all.length === 0}
        {@render firstUseBox()}
      {:else}
        <div class="space-y-8">
          {#each allGroups as g (g.key)}
            <section>
              <div class="mb-4 flex items-end gap-3">
                <span class="text-body font-semibold">{g.label}</span>
                <span class="text-caption text-muted-foreground tabular-nums"
                  >{g.items.length}</span
                >
                <div class="ml-1 flex-1 border-t border-border-subtle"></div>
              </div>
              {#if g.past}{@render pastGrid(g.items)}{:else}{@render posterGrid(g.items)}{/if}
            </section>
          {/each}
        </div>
      {/if}
    {:else if currentTab === "live"}
      {#if live.length === 0}{@render emptyBox()}{:else}{@render posterGrid(live)}{/if}
    {:else if currentTab === "upcoming"}
      {#if upcoming.length === 0}{@render emptyBox()}{:else}{@render posterGrid(upcoming)}{/if}
    {:else}
      {#if past.length === 0}{@render emptyBox()}{:else}{@render pastGrid(past)}{/if}
    {/if}

    <Dialog.Root bind:open={joinDialogOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{m.contestsList_joinDialogTitle()}</Dialog.Title>
        </Dialog.Header>
        <form class="flex flex-col gap-4" method="POST" action="?/joinByCode" use:enhance>
          <!-- svelte-ignore a11y_autofocus -->
          <Input name="code" placeholder="spring-2026-final" autofocus />
          {#if actionData?.codeError}
            <p class="text-body-sm text-destructive">{actionData.codeError}</p>
          {/if}
          <div class="flex justify-end">
            <Button type="submit">{m.contestsList_joinSubmit()}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  </div>
</PageContainer>
