<script lang="ts">
  import ProblemWorkspace from "$lib/components/problem/Workspace.svelte";

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
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
</script>

<!-- Contest timer bar -->
<div
  class="flex items-center justify-between border-b border-border bg-[color:var(--color-panel)] px-4 py-2 text-xs backdrop-blur-sm"
>
  <div class="flex items-center gap-3">
    <a class="text-muted-foreground transition hover:text-foreground" href="/contests/{data.contestSlug}">
      &larr; {data.contestData.title}
    </a>
    <span class="text-muted-foreground">|</span>
    {#each data.contestData.problems as p (p.slug)}
      <a
        class="rounded px-2 py-1 text-xs font-medium transition {p.slug === data.problem.slug
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        href="/contests/{data.contestSlug}/problems/{p.slug}"
      >
        {String.fromCharCode(64 + p.ordinal)}
      </a>
    {/each}
  </div>
  <div class="flex items-center gap-2">
    <span class="text-muted-foreground">Time left:</span>
    <span class="font-mono font-semibold tabular-nums {remainingMs < 300_000 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}">
      {formatDuration(remainingMs)}
    </span>
  </div>
</div>

<div
  class="flex h-[calc(100vh-9.5rem)] overflow-hidden rounded-[2rem] border border-border"
>
  <ProblemWorkspace
    allowedLanguages={data.contestData.allowedLanguages}
    backLink={{ href: `/contests/${data.contestSlug}`, type: "contest" }}
    contestSlug={data.contestSlug}
    initialSubmissions={data.submissions}
    problem={data.problem}
  />
</div>
