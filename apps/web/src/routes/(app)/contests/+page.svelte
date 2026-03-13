<script lang="ts">
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";

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
        class="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
        href="/contests/create"
      >
        Create Contest
      </a>
    {/if}
  </div>

  <div class="flex gap-3">
    <input
      class="min-w-0 flex-1 rounded-2xl border border-border bg-white/60 px-4 py-3 text-sm"
      placeholder={m.contestDetail_searchPlaceholder()}
      type="search"
      bind:value={search}
    />
    <button
      class="shrink-0 rounded-2xl border border-border bg-white/60 px-5 py-3 text-sm font-medium text-muted-foreground transition hover:bg-white"
      type="button"
      onclick={() => (joinDialogOpen = true)}
    >
      {m.contestDetail_enterCodePlaceholder()}
    </button>
  </div>

  {#if actionData?.codeError}
    <p class="text-sm text-red-700">{actionData.codeError}</p>
  {/if}

  <Dialog.Root bind:open={joinDialogOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{m.contestDetail_enterCodePlaceholder()}</Dialog.Title>
      </Dialog.Header>
      <form
        class="flex flex-col gap-4"
        method="POST"
        action="?/joinByCode"
        use:enhance
      >
        <input
          class="w-full rounded-lg border border-border px-4 py-3 text-sm"
          name="code"
          placeholder="spring-2026-final"
          autofocus
        />
        <div class="flex justify-end">
          <button
            class="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            type="submit"
          >
            {m.contestDetail_go()}
          </button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  {#if filtered.length === 0}
    <p class="text-sm text-muted-foreground">{m.contestDetail_empty()}</p>
  {/if}

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
                <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                  {m.contestDetail_live()}
                </span>
              {:else if status === "upcoming"}
                <span class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                  Upcoming
                </span>
              {:else}
                <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-400">
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
</div>
