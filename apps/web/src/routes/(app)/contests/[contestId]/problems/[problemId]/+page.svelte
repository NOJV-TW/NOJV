<script lang="ts">
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

  let endsAt = $derived(new Date(data.contestData.endsAt));
  let remainingMs = $derived(Math.max(0, endsAt.getTime() - now.getTime()));

  function formatDuration(ms: number): string {
    if (ms <= 0) return "00:00:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
</script>

<!-- Contest timer bar — back link + remaining time. Problem-switching now
     lives inside the float drawer rendered by ProblemSolveView. -->
<div
  class="flex flex-wrap items-center justify-between gap-y-1 border-b border-border-subtle bg-[color:var(--color-panel)] px-4 py-2 text-caption backdrop-blur-sm"
>
  <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
    <a
      class="text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="/contests/{data.contestId}"
    >
      &larr; {data.contestData.title}
    </a>
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
  allowedLanguages={data.contestData.allowedLanguages}
  backLink={{ href: `/contests/${data.contestId}`, type: "contest" }}
  canRejudge={data.canRejudge}
  contestId={data.contestId}
  problem={data.problem}
  siblingProblems={data.siblingProblems}
  submissions={data.submissions}
/>
