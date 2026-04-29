<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Trophy, Plus } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  type ParticipableContest = (typeof data)["participable"][number];
  type ManagedContest = (typeof data)["managed"][number];
  type AnyContest = ParticipableContest | ManagedContest;
  type TabKey = "participable" | "managed";

  let { data, form: actionData } = $props();

  let search = $state("");
  let joinDialogOpen = $state(false);

  const tabValue = $derived<TabKey>(
    page.url.searchParams.get("tab") === "managed" ? "managed" : "participable"
  );

  const tabCounts = $derived({
    participable: data.participable.length,
    managed: data.managed.length
  });

  function setTab(next: TabKey) {
    const url = new URL(page.url);
    if (next === "managed") url.searchParams.set("tab", "managed");
    else url.searchParams.delete("tab");
    goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true
    });
  }

  function applySearch<T extends AnyContest>(list: T[]): T[] {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }

  let filteredParticipable = $derived(applySearch(data.participable));
  let filteredManaged = $derived(applySearch(data.managed));

  function statusOf(contest: { startsAt: string; endsAt: string }) {
    const now = Date.now();
    const starts = new Date(contest.startsAt).getTime();
    const ends = new Date(contest.endsAt).getTime();
    if (now < starts) return "upcoming";
    if (now <= ends) return "active";
    return "ended";
  }
</script>

{#snippet contestCard(contest: AnyContest)}
  {@const status = statusOf(contest)}
  {@const visibilityLabel =
    "visibility" in contest && contest.visibility === "draft"
      ? m.contests_visibilityDraft()
      : "visibility" in contest && contest.visibility === "archived"
        ? m.contests_visibilityArchived()
        : null}
  <a class="block" href="/contests/{contest.id}">
    <Card variant="surface" size="lg" interactive>
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="text-caption uppercase tracking-wide text-muted-foreground">
              {contest.scoringMode}
            </p>
            {#if status === "active"}
              <Badge variant="success">{m.contestDetail_live()}</Badge>
            {:else if status === "upcoming"}
              <Badge variant="info">{m.contests_statusUpcoming()}</Badge>
            {:else}
              <Badge variant="muted">{m.contests_statusEnded()}</Badge>
            {/if}
          </div>
          <div class="mt-2 flex items-center gap-2 flex-wrap">
            <h3 class="font-display text-title font-semibold [text-wrap:balance]">
              {contest.title}
            </h3>
            {#if visibilityLabel}
              <span class="rounded-sm bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                {visibilityLabel}
              </span>
            {/if}
          </div>
          {#if contest.summary}
            <p class="mt-1 text-body-sm text-muted-foreground [text-wrap:pretty]">
              {contest.summary}
            </p>
          {/if}
        </div>
      </div>
      <dl class="mt-5 grid gap-4 sm:grid-cols-3 rounded-sm bg-[color:var(--color-panel-strong)] p-4">
        <div>
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.contestDetail_problems()}
          </dt>
          <dd class="mt-1 font-display text-title-sm font-semibold tabular-nums">
            {contest.problemCount}
          </dd>
        </div>
        <div>
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.contests_participants()}
          </dt>
          <dd class="mt-1 font-display text-title-sm font-semibold tabular-nums">
            {contest.participantCount}
          </dd>
        </div>
        <div>
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.contestDetail_scoreboard()}
          </dt>
          <dd class="mt-1 text-body-sm font-medium">{contest.scoreboardMode}</dd>
        </div>
      </dl>
    </Card>
  </a>
{/snippet}

{#snippet tabBody(list: AnyContest[], filtered: AnyContest[], emptyTitle: string)}
  {#if list.length === 0}
    <EmptyState
      variant="minimal"
      icon={Trophy}
      title={emptyTitle}
      description={m.contests_emptyHint()}
    />
  {:else if filtered.length === 0}
    <EmptyState
      variant="minimal"
      icon={Trophy}
      title={m.contests_noMatches()}
      description={m.contests_noMatchesHint()}
    />
  {:else}
    <section class="grid gap-4 lg:grid-cols-2">
      {#each filtered as contest (contest.id)}
        {@render contestCard(contest)}
      {/each}
    </section>
  {/if}
{/snippet}

<div class="pb-24">
  <header class="animate-in mb-8">
    <p class="text-caption uppercase tracking-[0.12em] text-muted-foreground">
      {m.contests_eyebrow()}
    </p>
    <h1 class="mt-1 font-display text-display font-medium tracking-[-0.02em]">
      {m.navigation_contests()}
    </h1>
    <p class="mt-2 text-body text-muted-foreground">
      {m.contests_subtitle()}
    </p>
  </header>

  <div class="animate-in animate-in-1 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border">
    <div
      role="tablist"
      aria-label={m.navigation_contests()}
      class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
    >
      {#each [{ key: "participable" as const, label: m.contests_tabParticipable(), count: tabCounts.participable }, { key: "managed" as const, label: m.contests_tabManaged(), count: tabCounts.managed }] as tab (tab.key)}
        {@const isActive = tab.key === tabValue}
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
      <Button variant="outline" type="button" onclick={() => (joinDialogOpen = true)}>
        {m.contestDetail_enterCode()}
      </Button>
      <Button href="/contests/create">
        <Plus class="h-4 w-4" />
        {m.contests_create()}
      </Button>
    {/if}
  </div>

  <div class="animate-in animate-in-2 mb-6">
    <Input
      class="min-w-0 flex-1"
      placeholder={m.contestDetail_searchPlaceholder()}
      type="search"
      bind:value={search}
    />
    {#if actionData?.codeError}
      <p class="mt-2 text-body-sm text-destructive">{actionData.codeError}</p>
    {/if}
  </div>

  <div class="animate-in animate-in-3" role="tabpanel">
    {#if tabValue === "participable"}
      {@render tabBody(data.participable, filteredParticipable, m.contests_emptyParticipable())}
    {:else}
      {@render tabBody(data.managed, filteredManaged, m.contests_emptyManaged())}
    {/if}
  </div>

  <Dialog.Root bind:open={joinDialogOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{m.contestDetail_enterCode()}</Dialog.Title>
      </Dialog.Header>
      <form class="flex flex-col gap-4" method="POST" action="?/joinByCode" use:enhance>
        <!-- svelte-ignore a11y_autofocus -->
        <Input name="code" placeholder="spring-2026-final" autofocus />
        <div class="flex justify-end">
          <Button type="submit">
            {m.contestDetail_go()}
          </Button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>
</div>
