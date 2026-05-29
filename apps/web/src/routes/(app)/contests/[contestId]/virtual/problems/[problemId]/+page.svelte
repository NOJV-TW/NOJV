<script lang="ts">
  import { goto } from "$app/navigation";
  import ProblemSolveView from "$lib/components/features/problem/views/ProblemSolveView.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();

  let now = $state(new Date());

  $effect(() => {
    const interval = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(interval);
  });

  let endsAt = $derived(new Date(data.virtual.endsAt));
  let remainingMs = $derived(Math.max(0, endsAt.getTime() - now.getTime()));

  $effect(() => {
    if (remainingMs <= 0) {
      void goto(`/contests/${data.contestId}/virtual`);
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

<div
  class="flex flex-wrap items-center justify-between gap-y-1 border-b border-border-subtle bg-[color:var(--color-panel)] px-4 py-2 text-caption backdrop-blur-sm"
>
  <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
    <a
      class="text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="/contests/{data.contestId}/virtual"
    >
      &larr; {data.virtual.contestTitle}
    </a>
    <span
      class="rounded-sm px-2 py-0.5 text-micro font-mono uppercase tracking-wider"
      style="background: color-mix(in oklab, var(--primary) 16%, transparent); color: var(--primary);"
    >
      {m.virtualContest_badge()}
    </span>
  </div>
  <div class="flex items-center gap-2">
    <span class="text-muted-foreground">{m.contests_timeLeft()}:</span>
    <span
      class="font-mono font-semibold tabular-nums {remainingMs < 300_000
        ? 'text-destructive'
        : 'text-foreground'}"
    >
      {formatDuration(remainingMs)}
    </span>
  </div>
</div>

<ProblemSolveView
  mode="practice"
  backLink={{ href: `/contests/${data.contestId}/virtual`, type: "contest" }}
  problem={data.problem}
  siblingProblems={data.siblingProblems}
  submissions={data.submissions}
  virtualContestId={data.virtual.virtualContestId}
/>
