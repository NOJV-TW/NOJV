<script lang="ts">
  import { toasts } from "$lib/stores/toast";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/ui/card/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button";
  import ScoreOverrideDrawer from "$lib/components/score-override/ScoreOverrideDrawer.svelte";
  import ClarificationTab from "$lib/components/clarification/ClarificationTab.svelte";
  import Lock from "@lucide/svelte/icons/lock";

  let { data } = $props();

  let contest = $derived(data.contest);

  let showOverrideDrawer = $state(false);
  const canSetOverride = $derived(data.canSetOverride);
  const overrideStudents = $derived(data.overrideStudents);
  const overrideProblems = $derived(
    (contest.problems ?? []).map((p) => ({ id: p.id, title: p.title }))
  );

  let now = $state(new Date());

  $effect(() => {
    const interval = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(interval);
  });

  let startsAt = $derived(new Date(contest.startsAt));
  let endsAt = $derived(new Date(contest.endsAt));
  let hasStarted = $derived(now >= startsAt);
  let hasEnded = $derived(now > endsAt);
  let isActive = $derived(hasStarted && !hasEnded);

  let remainingMs = $derived(
    !hasStarted
      ? startsAt.getTime() - now.getTime()
      : isActive
        ? endsAt.getTime() - now.getTime()
        : 0
  );

  // Countdown warnings
  let notified5min = $state(false);
  let notified1min = $state(false);

  $effect(() => {
    if (!isActive) return;
    const ms = remainingMs;
    if (ms <= 5 * 60 * 1000 && ms > 4 * 60 * 1000 && !notified5min) {
      notified5min = true;
      toasts.add({ message: "5 minutes remaining!", type: "info", duration: 8000 });
    }
    if (ms <= 60 * 1000 && ms > 0 && !notified1min) {
      notified1min = true;
      toasts.add({ message: "1 minute remaining!", type: "error", duration: 10000 });
    }
  });

  function formatDuration(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
</script>

<div class="space-y-8">
  <!-- Hero -->
  <Card variant="elevated" size="hero">
    <div class="flex items-center gap-2 flex-wrap justify-between">
      <div class="flex items-center gap-2 flex-wrap">
        <Badge variant="muted">{contest.scoringMode}</Badge>
        {#if isActive}
          <Badge variant="success">{m.contests_statusActive()}</Badge>
        {:else if !hasStarted}
          <Badge variant="info">{m.contests_statusUpcoming()}</Badge>
        {:else}
          <Badge variant="muted">{m.contests_statusEnded()}</Badge>
        {/if}
      </div>
      {#if canSetOverride}
        <Button
          variant="outline"
          size="sm"
          type="button"
          onclick={() => (showOverrideDrawer = true)}
        >
          {m.override_staff_buttonLabel()}
        </Button>
      {/if}
    </div>
    <h1 class="font-display text-title-lg font-semibold [text-wrap:balance]">
      {contest.title}
    </h1>
    {#if contest.summary}
      <p class="text-body text-muted-foreground [text-wrap:pretty]">{contest.summary}</p>
    {/if}

    {#if !hasEnded}
      <div class="rounded-sm bg-[color:var(--color-panel-strong)] px-5 py-4 mt-2">
        <p class="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {!hasStarted ? m.contests_startsIn() : m.contests_timeRemaining()}
        </p>
        <p class="mt-1 font-mono text-headline tabular-nums font-semibold">
          {formatDuration(remainingMs)}
        </p>
      </div>
    {/if}
  </Card>

  <!-- Contest info grid -->
  <div class="grid gap-4 sm:grid-cols-3">
    <Card variant="surface" size="md">
      <p class="text-caption uppercase tracking-wide text-muted-foreground">
        {m.contests_starts()}
      </p>
      <p class="mt-1 text-body-sm font-medium tabular-nums">{startsAt.toLocaleString()}</p>
    </Card>
    <Card variant="surface" size="md">
      <p class="text-caption uppercase tracking-wide text-muted-foreground">
        {m.contests_ends()}
      </p>
      <p class="mt-1 text-body-sm font-medium tabular-nums">{endsAt.toLocaleString()}</p>
    </Card>
    <Card variant="surface" size="md">
      <p class="text-caption uppercase tracking-wide text-muted-foreground">
        {m.contests_participants()}
      </p>
      <p class="mt-1 font-display text-title-sm font-semibold tabular-nums">
        {contest.participantCount}
      </p>
    </Card>
  </div>

  <!-- Contest settings (standalone contests have no proctoring) -->
  <div class="flex flex-wrap gap-2">
    {#if contest.submitCooldownSec > 0}
      <Badge variant="muted">{m.contests_cooldownLabel()}: {contest.submitCooldownSec}s</Badge>
    {/if}
    <Badge variant="muted">{m.contestDetail_scoreboard()}: {contest.scoreboardMode}</Badge>
    {#if contest.allowedLanguages.length > 0}
      <Badge variant="muted">
        {m.contestCreate_allowedLanguages()}: {contest.allowedLanguages.join(", ")}
      </Badge>
    {/if}
  </div>

  <!-- Problems -->
  <div class="space-y-4">
    <h2 class="font-display text-title font-semibold">{m.contestDetail_contestProblems()}</h2>

    <div class="grid gap-3">
      {#if contest.problemsHidden}
        <Card variant="surface" size="md" class="flex-col items-center justify-center gap-3 py-10 text-center">
          <Lock class="h-8 w-8 text-muted-foreground" />
          <h3 class="font-display text-title-sm font-semibold">
            {m.contestDetail_problemsHiddenTitle()}
          </h3>
          <p class="text-body-sm text-muted-foreground">
            {m.contestDetail_problemsHiddenBody()}
          </p>
          {#if !hasStarted}
            <p class="font-mono text-body-sm tabular-nums text-muted-foreground">
              {formatDuration(remainingMs)}
            </p>
          {/if}
        </Card>
      {:else}
        {#each data.contest.problems ?? [] as p (p.id)}
          {@const href =
            isActive || data.contest.isManager
              ? `/contests/${data.contest.id}/problems/${p.id}`
              : hasEnded
                ? // Once the contest has ended, problems become ordinary
                  // practice — strip contest context so submissions don't
                  // touch the scoreboard or frozen participation.
                  `/problems/${p.id}`
                : null}
          {#if href}
            <a class="block" {href}>
              <Card variant="surface" size="md" interactive class="flex-row items-center justify-between">
                <div class="flex items-center gap-3">
                  <span class="flex h-8 w-8 items-center justify-center rounded-sm bg-muted font-display text-body-sm font-semibold text-muted-foreground">
                    {String.fromCharCode(64 + p.ordinal)}
                  </span>
                  <span class="font-medium text-body">{p.title}</span>
                </div>
                <span class="text-caption text-muted-foreground tabular-nums">
                  {p.points} {m.contestDetail_pts()}
                </span>
              </Card>
            </a>
          {:else}
            <Card variant="flat" size="md" class="flex-row items-center justify-between opacity-60">
              <div class="flex items-center gap-3">
                <span class="flex h-8 w-8 items-center justify-center rounded-sm bg-muted font-display text-body-sm font-semibold text-muted-foreground">
                  {String.fromCharCode(64 + p.ordinal)}
                </span>
                <span class="font-medium text-body">{p.title}</span>
              </div>
              <span class="text-caption text-muted-foreground tabular-nums">
                {p.points} {m.contestDetail_pts()}
              </span>
            </Card>
          {/if}
        {/each}
      {/if}
    </div>
  </div>

  {#if data.clarification.canAsk || data.clarification.canAnswer}
    <section class="space-y-4">
      <h2 class="font-display text-title font-semibold">{m.clarification_tab_title()}</h2>
      <ClarificationTab
        contextType="contest"
        contextId={contest.id}
        canAsk={data.clarification.canAsk}
        canAnswer={data.clarification.canAnswer}
        problems={(contest.problems ?? []).map((p) => ({ id: p.id, title: p.title }))}
      />
    </section>
  {/if}
</div>

{#if canSetOverride}
  <ScoreOverrideDrawer
    open={showOverrideDrawer}
    onOpenChange={(v) => (showOverrideDrawer = v)}
    contextType="contest"
    contextId={contest.id}
    students={overrideStudents}
    problems={overrideProblems}
  />
{/if}
