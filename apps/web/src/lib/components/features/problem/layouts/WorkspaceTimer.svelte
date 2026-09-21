<script lang="ts">
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemWorkspaceTimer } from "./ProblemLeftPanel.svelte";

  let { timer }: { timer: ProblemWorkspaceTimer } = $props();

  let now = $state(Date.now());
  let expired = $state(false);

  $effect(() => {
    const interval = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(interval);
  });

  const finalMs = $derived(new Date(timer.endsAt).getTime());
  const dueMs = $derived(
    timer.type === "contest" ? finalMs : new Date(timer.dueAt ?? timer.endsAt).getTime(),
  );
  const allowsLate = $derived(timer.type !== "contest" && dueMs < finalMs);
  const isLate = $derived(allowsLate && now > dueMs);
  const closed = $derived(now >= finalMs);
  const remainingMs = $derived(Math.max(0, (isLate ? finalMs : dueMs) - now));
  const latePenalty = $derived(timer.type === "contest" ? null : timer.latePenalty);

  function formatCountdown(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  const countdown = $derived(formatCountdown(remainingMs));
  const urgencyClass = $derived(
    remainingMs <= 60_000
      ? "text-destructive"
      : remainingMs <= 300_000
        ? "text-warning"
        : "text-foreground",
  );

  $effect(() => {
    if (timer.type !== "exam" || !closed || expired) return;
    expired = true;
    void goto(`/exams/${timer.examId}`);
  });
</script>

<div
  class="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-caption"
  data-slot="workspace-timer"
>
  <span class={isLate ? "text-warning" : "text-muted-foreground"}>
    {#if timer.type === "contest"}{m.contests_timeLeft()}
    {:else if closed}{m.lateSubmission_workspaceClosed()}
    {:else if isLate}{m.lateSubmission_workspaceLateCountdown()}
    {:else}{m.lateSubmission_workspaceDueCountdown()}{/if}
  </span>
  <span class="font-mono font-semibold tabular-nums {urgencyClass}">{countdown}</span>
  {#if timer.type === "exam"}
    <a
      href={`/exams/${timer.examId}`}
      class="focus-ring ml-2 inline-flex min-h-9 items-center rounded-md px-2 font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {m.examMode_overview()}
    </a>
  {/if}
  {#if allowsLate && !closed}
    <p class="basis-full leading-relaxed text-muted-foreground" role="status">
      {#if latePenalty?.type === "flat_late_penalty"}{m.lateSubmission_flatSummary({
          pct: latePenalty.penaltyPct,
        })}
      {:else if latePenalty?.type === "daily_late_penalty"}{m.lateSubmission_dailySummary({
          pct: latePenalty.perDayPct,
        })}
      {:else}{m.lateSubmission_noPenalty()}{/if}
    </p>
  {/if}
</div>
