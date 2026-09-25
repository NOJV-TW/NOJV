<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Plus } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/primitives/ui/dialog/index.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import { Input } from "$lib/components/primitives/ui/input/index.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import FilterTabs from "$lib/components/primitives/visual/FilterTabs.svelte";
  import ContestPoster from "$lib/components/features/contest/ContestPoster.svelte";
  import ContestRowPast from "$lib/components/features/contest/ContestRowPast.svelte";
  import AssessmentGroupHeading from "$lib/components/features/coursework/AssessmentGroupHeading.svelte";
  import { contestStatusFor } from "$lib/components/features/contest/format";

  let { data, form: actionData } = $props();

  let joinDialogOpen = $state(false);

  type Contest = (typeof data)["participable"][number];

  function decorate(c: Contest) {
    const status = contestStatusFor(c.startsAt, c.endsAt);
    return {
      raw: c,
      status,
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
    { key: "all", label: m.contestsList_tabAll() },
    { key: "live", label: m.contestsList_tabLive() },
    { key: "upcoming", label: m.contestsList_tabUpcoming() },
    { key: "ended", label: m.contestsList_tabEnded() },
  ]);

  const allGroups = $derived(
    (
      [
        { key: "live", label: m.contestsList_tabLive(), items: live, past: false },
        { key: "upcoming", label: m.contestsList_tabUpcoming(), items: upcoming, past: false },
        { key: "ended", label: m.contestsList_tabEnded(), items: past, past: true },
      ] as const
    ).filter((g) => g.items.length > 0),
  );
</script>

<PageContainer>
  <div class="space-y-8 fade-up">
    <PageHeader title={m.contestsList_heroTitle()} />

    {#snippet posterGrid(items: typeof all)}
      <div class="grid gap-2">
        {#each items as c, i (c.raw.id)}
          <ContestPoster
            href="/contests/{c.raw.id}"
            scoringLabel={c.raw.organizer}
            status={c.status}
            title={c.raw.title}
            summary={c.raw.summary}
            startsAt={c.raw.startsAt}
            endsAt={c.raw.endsAt}
            showStatusIcon={currentTab !== "all"}
            score={c.raw.score}
            totalPoints={c.raw.totalPoints}
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
            scoringLabel={c.raw.organizer}
            title={c.raw.title}
            startsAt={c.raw.startsAt}
            endsAt={c.raw.endsAt}
            showStatusIcon={currentTab !== "all"}
            score={c.raw.score}
            totalPoints={c.raw.totalPoints}
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
            {#if data.canCreate}
              <Button href="/contests/new" size="sm">
                <Plus aria-hidden="true" class="h-4 w-4" />
                {m.contestsList_create()}
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    {/snippet}

    <FilterTabs {tabs} value={currentTab} label={m.contestsList_heroTitle()} onSelect={setTab}>
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
          {#if data.canCreate}
            <Button href="/contests/new" size="sm">
              <Plus aria-hidden="true" class="h-4 w-4" />
              {m.contestsList_create()}
            </Button>
          {/if}
        </div>
      {/if}
    </FilterTabs>

    {#if currentTab === "all"}
      {#if all.length === 0}
        {@render firstUseBox()}
      {:else}
        <div class="space-y-8">
          {#each allGroups as g (g.key)}
            <section>
              <AssessmentGroupHeading label={g.label} status={g.key} />
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
          {#if actionData?.codeError || actionData?.error}
            <p role="alert" class="text-body-sm text-destructive">
              {actionData.codeError ?? actionData.error}
            </p>
          {/if}
          <div class="flex justify-end">
            <Button type="submit">{m.contestsList_joinSubmit()}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  </div>
</PageContainer>
