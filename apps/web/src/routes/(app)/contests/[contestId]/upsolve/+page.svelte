<script lang="ts">
  import { Dumbbell } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import type { contestDomain } from "@nojv/domain";
  import Crumbs from "$lib/components/primitives/visual/Crumbs.svelte";
  import GlassPanel from "$lib/components/primitives/visual/GlassPanel.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  let { data } = $props();
  const view = $derived(data.view);

  const summary = $derived({
    solved: view.problems.filter((p) => p.status === "solved").length,
    attempted: view.problems.filter((p) => p.status === "attempted").length,
    untouched: view.problems.filter((p) => p.status === "untouched").length
  });

  function statusLabel(status: contestDomain.UpsolveStatus): string {
    return status === "solved"
      ? m.contestUpsolve_statusSolved()
      : status === "attempted"
        ? m.contestUpsolve_statusAttempted()
        : m.contestUpsolve_statusUntouched();
  }

  function statusStyle(status: contestDomain.UpsolveStatus): string {
    if (status === "solved") {
      return "background: color-mix(in oklab, var(--success) 16%, transparent); color: var(--success);";
    }
    if (status === "attempted") {
      return "background: color-mix(in oklab, #d4a054 20%, transparent); color: #b07d2c;";
    }
    return "background: var(--muted); color: var(--muted-foreground);";
  }
</script>

<div class="space-y-6 fade-up px-6 py-8 lg:px-10 pb-20">
  <Crumbs
    items={[
      { label: m.navigation_contests(), href: "/contests" },
      { label: view.contestId, href: `/contests/${view.contestId}` },
      { label: m.contestDetail_actionUpsolve() }
    ]}
  />

  
  <div class="glass rounded-xl shadow-rest p-5 flex flex-wrap items-center gap-6">
    <div class="flex-1 min-w-0">
      <div
        class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.2em] text-muted-foreground"
      >
        <Dumbbell aria-hidden="true" class="size-3.5" />
        <span>{m.contestUpsolve_eyebrow()}</span>
      </div>
      <h1 class="mt-2 text-headline font-semibold tracking-tight">
        {m.contestUpsolve_heroHeading()}
      </h1>
      <p class="text-caption text-muted-foreground">
        {m.contestUpsolve_heroHint({ title: view.title })}
      </p>
    </div>

    <div class="grid grid-cols-3 gap-5 text-center">
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestUpsolve_statusSolved()}
        </div>
        <div
          class="mt-1 text-title font-semibold tabular-nums"
          style="color: var(--success);"
        >
          {summary.solved}
        </div>
      </div>
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestUpsolve_statusAttempted()}
        </div>
        <div class="mt-1 text-title font-semibold tabular-nums" style="color: #b07d2c;">
          {summary.attempted}
        </div>
      </div>
      <div>
        <div class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
          {m.contestUpsolve_statusUntouched()}
        </div>
        <div class="mt-1 text-title font-semibold tabular-nums text-muted-foreground">
          {summary.untouched}
        </div>
      </div>
    </div>
  </div>

  
  <GlassPanel class="overflow-hidden">
    <div
      class="flex items-center justify-between px-6 py-4 border-b"
      style="border-color: var(--border-subtle);"
    >
      <h2 class="text-title font-semibold">{m.contestUpsolve_listHeading()}</h2>
      <div class="text-caption text-muted-foreground">
        {m.contestUpsolve_listMeta({ count: view.problems.length })}
      </div>
    </div>

    {#if view.problems.length === 0}
      <EmptyState
        icon={Dumbbell}
        title={m.contestUpsolve_emptyTitle()}
        description={m.contestUpsolve_emptyDescription()}
      />
    {:else}
      <div class="divide-y" style="border-color: var(--border-subtle);">
        {#each view.problems as p (p.problemId)}
          <a
            href="/problems/{p.problemId}"
            class="grid grid-cols-[48px_1fr_auto] sm:grid-cols-[48px_1fr_minmax(110px,140px)_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/40"
          >
            <div
              class="font-mono text-title font-semibold"
              style="color: var(--primary);"
            >
              {p.letter}
            </div>
            <div class="min-w-0">
              <div class="font-medium truncate">{p.title}</div>
              <div
                class="mt-1 text-micro font-mono uppercase tracking-wider text-muted-foreground tabular-nums"
              >
                {m.contestUpsolve_pointsLabel({ count: p.points })}
              </div>
            </div>
            <div class="hidden sm:flex justify-start">
              <span
                class="text-micro font-mono uppercase tracking-wider px-2.5 py-1 rounded-sm"
                style={statusStyle(p.status)}
              >
                {statusLabel(p.status)}
              </span>
            </div>
            <span
              class="text-caption font-medium px-3 py-1.5 rounded-md border text-muted-foreground"
              style="border-color: var(--border-subtle);"
            >
              {m.contestUpsolve_practiceCta()}
            </span>
          </a>
        {/each}
      </div>
    {/if}
  </GlassPanel>
</div>
