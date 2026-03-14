<script lang="ts">
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Trophy, Plus } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

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
  <div class="flex items-center justify-between">
    <h2 class="font-[family-name:var(--font-display)] text-3xl">{m.navigation_contests()}</h2>
    {#if data.loggedIn}
      <a
        class="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
        href="/contests/create"
      >
        <Plus class="h-4 w-4" />
        Create Contest
      </a>
    {/if}
  </div>

  <div class="flex gap-3">
    <input
      class="min-w-0 flex-1 rounded-full border border-border bg-[color:var(--color-panel)] px-4 py-2.5 text-sm"
      placeholder={m.contestDetail_searchPlaceholder()}
      type="search"
      bind:value={search}
    />
    <button
      class="shrink-0 rounded-full border border-border bg-[color:var(--color-panel)] px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent"
      type="button"
      onclick={() => (joinDialogOpen = true)}
    >
      {m.contestDetail_enterCode()}
    </button>
  </div>

  {#if actionData?.codeError}
    <p class="text-sm text-red-700 dark:text-red-400">{actionData.codeError}</p>
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
        <input
          class="w-full rounded-full border border-border px-4 py-2.5 text-sm"
          name="code"
          placeholder="spring-2026-final"
          autofocus
        />
        <div class="flex justify-end">
          <button
            class="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
            type="submit"
          >
            {m.contestDetail_go()}
          </button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  {#if data.contests.length === 0}
    <EmptyState
      icon={Trophy}
      title={m.contestDetail_empty()}
    />
  {:else if filtered.length === 0}
    <EmptyState
      icon={Trophy}
      title={m.contestDetail_empty()}
    />
  {:else}
    <section class="grid gap-4 lg:grid-cols-2">
      {#each filtered as contest (contest.slug)}
        {@const status = statusOf(contest)}
        <a
          class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm transition hover:-translate-y-0.5"
          href="/contests/{contest.slug}"
        >
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
                  {contest.scoringMode}
                </p>
                {#if status === "active"}
                  <span class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">
                    {m.contestDetail_live()}
                  </span>
                {:else if status === "upcoming"}
                  <span class="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600">
                    Upcoming
                  </span>
                {:else}
                  <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Ended
                  </span>
                {/if}
              </div>
              <h3 class="mt-2 text-2xl font-semibold">{contest.title}</h3>
              {#if contest.summary}
                <p class="mt-1 text-sm text-muted-foreground">{contest.summary}</p>
              {/if}
            </div>
          </div>
          <dl class="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <dt class="text-sm text-muted-foreground">{m.contestDetail_problems()}</dt>
              <dd class="mt-1 text-lg font-semibold">{contest.problemCount}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted-foreground">Participants</dt>
              <dd class="mt-1 text-lg font-semibold">{contest.participantCount}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted-foreground">{m.contestDetail_scoreboard()}</dt>
              <dd class="mt-1 text-lg font-semibold">{contest.scoreboardMode}</dd>
            </div>
          </dl>
        </a>
      {/each}
    </section>
  {/if}
</div>
