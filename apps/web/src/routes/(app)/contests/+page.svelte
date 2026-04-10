<script lang="ts">
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Trophy, Plus } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  let { data, form: actionData } = $props();

  let search = $state("");
  let joinDialogOpen = $state(false);

  let filtered = $derived(
    search
      ? data.contests.filter(
          (c) =>
            c.title.toLowerCase().includes(search.toLowerCase()) ||
            c.slug.toLowerCase().includes(search.toLowerCase())
        )
      : data.contests
  );

  function statusOf(contest: { startsAt: string; endsAt: string }) {
    const now = Date.now();
    const starts = new Date(contest.startsAt).getTime();
    const ends = new Date(contest.endsAt).getTime();
    if (now < starts) return "upcoming";
    if (now <= ends) return "active";
    return "ended";
  }
</script>

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

  {#if data.contests.length === 0}
    <EmptyState
      variant="minimal"
      icon={Trophy}
      title={m.contests_empty()}
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
      {#each filtered as contest (contest.slug)}
        {@const status = statusOf(contest)}
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
                <h3 class="mt-2 font-display text-title font-semibold [text-wrap:balance]">
                  {contest.title}
                </h3>
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
      {/each}
    </section>
  {/if}
</div>
