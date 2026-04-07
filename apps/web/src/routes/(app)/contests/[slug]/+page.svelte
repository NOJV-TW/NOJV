<script lang="ts">
  let { data } = $props();

  let contest = $derived(data.contest);

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


  function formatDuration(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
</script>

<div class="space-y-8">
  <!-- Header -->
  <div>
    <div class="flex items-center gap-3">
      <span class="rounded-full bg-muted px-3 py-1 text-xs font-medium uppercase text-muted-foreground">
        {contest.scoringMode}
      </span>
      {#if isActive}
        <span class="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-600">
          Active
        </span>
      {:else if !hasStarted}
        <span class="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-600">
          Upcoming
        </span>
      {:else}
        <span class="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Ended
        </span>
      {/if}
    </div>
    <h1 class="mt-3 font-[family-name:var(--font-display)] text-3xl">{contest.title}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{contest.summary}</p>
  </div>

  <!-- Timer -->
  {#if !hasEnded}
    <div class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-5">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {!hasStarted ? "Starts in" : "Time remaining"}
      </p>
      <p class="mt-1 font-mono text-3xl tabular-nums font-semibold">
        {formatDuration(remainingMs)}
      </p>
    </div>
  {/if}

  <!-- Contest info -->
  <div class="grid gap-4 sm:grid-cols-3">
    <div class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4">
      <p class="text-xs text-muted-foreground">Starts</p>
      <p class="mt-1 text-sm font-medium">{startsAt.toLocaleString()}</p>
    </div>
    <div class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4">
      <p class="text-xs text-muted-foreground">Ends</p>
      <p class="mt-1 text-sm font-medium">{endsAt.toLocaleString()}</p>
    </div>
    <div class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4">
      <p class="text-xs text-muted-foreground">Participants</p>
      <p class="mt-1 text-sm font-medium">{contest.participantCount}</p>
    </div>
  </div>

  <!-- Contest settings -->
  <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
    {#if contest.submitCooldownSec > 0}
      <span class="rounded-full bg-muted px-3 py-1">
        Cooldown: {contest.submitCooldownSec}s
      </span>
    {/if}
    {#if contest.maxAttempts != null}
      <span class="rounded-full bg-muted px-3 py-1">
        Max attempts: {contest.maxAttempts}
      </span>
    {/if}
    {#if contest.pageLockEnabled}
      <span class="rounded-full bg-amber-500/15 px-3 py-1 text-amber-600">Page lock</span>
    {/if}
    {#if contest.ipWhitelistEnabled}
      <span class="rounded-full bg-amber-500/15 px-3 py-1 text-amber-600">IP whitelist</span>
    {/if}
    {#if contest.ipBindingEnabled}
      <span class="rounded-full bg-amber-500/15 px-3 py-1 text-amber-600">IP binding</span>
    {/if}
    <span class="rounded-full bg-muted px-3 py-1">
      Scoreboard: {contest.scoreboardMode}
    </span>
    {#if contest.allowedLanguages.length > 0}
      <span class="rounded-full bg-muted px-3 py-1">
        Languages: {contest.allowedLanguages.join(", ")}
      </span>
    {/if}
  </div>

  <!-- Problems -->
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">Problems</h2>

    <div class="grid gap-3">
      {#each contest.problems as p (p.id)}
        {@const href = isActive ? `/contests/${contest.slug}/problems/${p.id}` : null}
        {#if href}
          <a
            class="flex items-center justify-between rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4 transition hover:-translate-y-0.5 hover:border-border"
            {href}
          >
            <div class="flex items-center gap-3">
              <span class="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {String.fromCharCode(64 + p.ordinal)}
              </span>
              <span class="font-medium">{p.title}</span>
            </div>
            <span class="text-xs text-muted-foreground">{p.points} pts</span>
          </a>
        {:else}
          <div class="flex items-center justify-between rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-4 opacity-60">
            <div class="flex items-center gap-3">
              <span class="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {String.fromCharCode(64 + p.ordinal)}
              </span>
              <span class="font-medium">{p.title}</span>
            </div>
            <span class="text-xs text-muted-foreground">{p.points} pts</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>
