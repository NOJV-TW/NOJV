<script lang="ts">
  import { Timer, Trophy } from "@lucide/svelte";
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  let { data, form } = $props();

  const virtual = $derived(data.virtual);
  const scoreboard = $derived(data.scoreboard);

  let starting = $state(false);
</script>

<PageContainer class="space-y-6 fade-up">
  <Crumbs
    items={[
      { label: m.navigation_contests(), href: "/contests" },
      { label: data.contestId, href: `/contests/${data.contestId}` },
      { label: m.virtualContest_badge() }
    ]}
  />

  
  <div class="glass rounded-xl shadow-rest p-5 flex flex-wrap items-center gap-6">
    <div class="flex-1 min-w-0">
      <div
        class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground"
      >
        <Timer aria-hidden="true" class="size-3.5" />
        <span>{m.virtualContest_eyebrow()}</span>
      </div>
      <h1 class="mt-2 text-headline font-semibold tracking-tight">
        {m.virtualContest_heroHeading()}
      </h1>
      <p class="text-caption text-muted-foreground">
        {m.virtualContest_heroHint({ title: data.contestTitle })}
      </p>
    </div>

    {#if virtual}
      <div
        class="rounded-lg border p-3 min-w-[220px]"
        style="border-color: var(--border); background: var(--panel);"
      >
        <div
          class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.18em] text-muted-foreground"
        >
          {#if virtual.status === "active"}
            <span class="size-1.5 rounded-full live-dot" style="background: var(--primary);"
            ></span>
            <span>{m.virtualContest_timerRunning()}</span>
          {:else}
            <span>{m.virtualContest_timerFinished()}</span>
          {/if}
        </div>
        <div class="mt-2 font-mono text-title">
          {#if virtual.status === "active"}
            <Countdown iso={virtual.endsAt} />
          {:else}
            00:00:00
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if !virtual}
    
    <GlassPanel class="p-8 text-center space-y-4">
      <p class="text-body text-muted-foreground">
        {m.virtualContest_startBlurb()}
      </p>
      {#if data.contestEnded}
        <form
          method="POST"
          action="?/start"
          use:enhance={() => {
            starting = true;
            return async ({ update }) => {
              await update();
              starting = false;
            };
          }}
        >
          <Button type="submit" disabled={starting}>
            {m.virtualContest_startCta()}
          </Button>
        </form>
      {:else}
        <p class="text-caption text-muted-foreground">
          {m.virtualContest_notEndedYet()}
        </p>
      {/if}
      {#if form?.error}
        <p class="text-caption text-destructive">{form.error}</p>
      {/if}
    </GlassPanel>
  {:else}
    
    
    <GlassPanel class="overflow-hidden">
      <div
        class="flex items-center justify-between px-6 py-4 border-b"
        style="border-color: var(--border-subtle);"
      >
        <h2 class="text-title font-semibold">{m.virtualContest_problemsHeading()}</h2>
        <div class="text-caption text-muted-foreground">
          {m.virtualContest_problemsMeta({ count: virtual.problems.length })}
        </div>
      </div>

      {#if virtual.problems.length === 0}
        <EmptyState
          icon={Timer}
          title={m.virtualContest_emptyTitle()}
          description={m.virtualContest_emptyDescription()}
        />
      {:else}
        <div class="divide-y" style="border-color: var(--border-subtle);">
          {#each virtual.problems as p (p.problemId)}
            {@const solvableHref =
              virtual.status === "active"
                ? `/contests/${virtual.contestId}/virtual/problems/${p.problemId}`
                : `/problems/${p.problemId}`}
            <a
              href={solvableHref}
              class="grid grid-cols-[48px_1fr_auto_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/40"
            >
              <div class="font-mono text-title font-semibold" style="color: var(--primary);">
                {p.letter}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">{p.title}</div>
                <div
                  class="mt-1 text-micro font-mono uppercase tracking-wider text-muted-foreground tabular-nums"
                >
                  {m.virtualContest_pointsLabel({ count: p.points })}
                </div>
              </div>
              <span
                class="text-micro font-mono uppercase tracking-wider px-2.5 py-1 rounded-sm"
                style={p.solved
                  ? "background: color-mix(in oklab, var(--success) 16%, transparent); color: var(--success);"
                  : "background: var(--muted); color: var(--muted-foreground);"}
              >
                {p.solved
                  ? m.virtualContest_statusSolved()
                  : m.virtualContest_statusUnsolved()}
              </span>
              <span class="font-mono tabular-nums text-caption text-muted-foreground">
                {p.bestScore}
              </span>
            </a>
          {/each}
        </div>
      {/if}
    </GlassPanel>

    
    {#if scoreboard}
      <GlassPanel class="overflow-hidden">
        <div
          class="flex items-center gap-2 px-6 py-4 border-b"
          style="border-color: var(--border-subtle);"
        >
          <Trophy aria-hidden="true" class="size-4" style="color: var(--primary);" />
          <h2 class="text-title font-semibold">{m.virtualContest_scoreboardHeading()}</h2>
        </div>
        <table class="w-full text-body-sm">
          <thead>
            <tr
              class="text-micro font-mono uppercase tracking-wider text-muted-foreground"
              style="border-bottom: 1px solid var(--border-subtle);"
            >
              <th class="px-6 py-2 text-left w-16">{m.virtualContest_colRank()}</th>
              <th class="px-3 py-2 text-left">{m.virtualContest_colWho()}</th>
              <th class="px-3 py-2 text-right">{m.virtualContest_colScore()}</th>
              <th class="px-6 py-2 text-right">{m.virtualContest_colPenalty()}</th>
            </tr>
          </thead>
          <tbody>
            {#each scoreboard.rows as row, i (i)}
              <tr
                class="border-b last:border-0"
                style="border-color: var(--border-subtle); {row.isMe
                  ? 'background: color-mix(in oklab, var(--primary) 8%, transparent);'
                  : ''}"
              >
                <td class="px-6 py-2 font-mono tabular-nums">{row.rank}</td>
                <td class="px-3 py-2">
                  <span class={row.isMe ? "font-semibold" : ""}>
                    {row.isMe ? m.virtualContest_youLabel() : row.username}
                  </span>
                  {#if row.isGhost}
                    <span
                      class="ml-2 text-micro font-mono uppercase tracking-wider text-muted-foreground"
                    >
                      {m.virtualContest_ghostTag()}
                    </span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-right font-mono tabular-nums">{row.totalScore}</td>
                <td class="px-6 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {row.totalPenalty}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </GlassPanel>
    {/if}
  {/if}
</PageContainer>
