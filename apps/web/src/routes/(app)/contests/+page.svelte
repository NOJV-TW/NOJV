<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { cn } from "$lib/utils.js";
  import { Trophy, Plus } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  type ParticipableContest = (typeof data)["participable"][number];
  type ManagedContest = (typeof data)["managed"][number];
  type AnyContest = ParticipableContest | ManagedContest;

  let { data, form: actionData } = $props();

  let search = $state("");
  let joinDialogOpen = $state(false);

  let tabValue = $derived(
    $page.url.searchParams.get("tab") === "managed" ? ("managed" as const) : ("participable" as const)
  );

  function applySearch<T extends AnyContest>(list: T[]): T[] {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
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
  <a class="block" href="/contests/{contest.slug}">
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

<div class="space-y-6">
  <Section>
    {#snippet header()}
      <h1 class="font-display text-title-lg">{m.navigation_contests()}</h1>
    {/snippet}
    {#snippet actions()}
      {#if data.loggedIn}
        <Button href="/contests/create" size="default">
          <Plus class="h-4 w-4" />
          {m.contests_create()}
        </Button>
      {/if}
    {/snippet}
  </Section>

  <div class="flex gap-3">
    <Input
      class="min-w-0 flex-1"
      placeholder={m.contestDetail_searchPlaceholder()}
      type="search"
      bind:value={search}
    />
    <Button variant="outline" type="button" onclick={() => (joinDialogOpen = true)}>
      {m.contestDetail_enterCode()}
    </Button>
  </div>

  {#if actionData?.codeError}
    <p class="text-body-sm text-destructive">{actionData.codeError}</p>
  {/if}

  <Dialog.Root bind:open={joinDialogOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{m.contestDetail_enterCode()}</Dialog.Title>
      </Dialog.Header>
      <form
        class="flex flex-col gap-4"
        method="POST"
        action="?/joinByCode"
        use:enhance
      >
        <!-- svelte-ignore a11y_autofocus -->
        <Input
          name="code"
          placeholder="spring-2026-final"
          autofocus
        />
        <div class="flex justify-end">
          <Button type="submit">
            {m.contestDetail_go()}
          </Button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <div>
    <div
      role="tablist"
      class="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
    >
      <a
        role="tab"
        href="/contests"
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        aria-selected={tabValue === "participable"}
        class={cn(
          "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-body-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          tabValue === "participable"
            ? "bg-background text-foreground shadow-rest"
            : "hover:text-foreground"
        )}
      >
        {m.contests_tabParticipable()}
      </a>
      <a
        role="tab"
        href="/contests?tab=managed"
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        aria-selected={tabValue === "managed"}
        class={cn(
          "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-body-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          tabValue === "managed"
            ? "bg-background text-foreground shadow-rest"
            : "hover:text-foreground"
        )}
      >
        {m.contests_tabManaged()}
      </a>
    </div>

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

    <div class="mt-4" role="tabpanel">
      {#if tabValue === "participable"}
        {@render tabBody(data.participable, filteredParticipable, m.contests_emptyParticipable())}
      {:else}
        {@render tabBody(data.managed, filteredManaged, m.contests_emptyManaged())}
      {/if}
    </div>
  </div>
</div>
