<script lang="ts">
  import { goto } from "$app/navigation";
  import { X } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import type { ProblemWorkspaceTimer } from "./ProblemLeftPanel.svelte";

  let { timer }: { timer: ProblemWorkspaceTimer } = $props();

  let now = $state(Date.now());
  let ending = $state(false);
  let expired = $state(false);

  $effect(() => {
    const interval = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(interval);
  });

  const remainingMs = $derived(Math.max(0, new Date(timer.endsAt).getTime() - now));

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
    if (timer.type !== "exam" || remainingMs !== 0 || expired || ending) return;
    expired = true;
    void goto(`/exams/${timer.examId}`);
  });

  async function endExam() {
    if (timer.type !== "exam" || ending || !window.confirm(m.examMode_submitEndConfirm()))
      return;
    ending = true;
    try {
      const response = await fetch(`/exams/${timer.examId}?/releaseSession`, {
        method: "POST",
        body: new FormData(),
      });
      if (!response.ok) {
        toasts.error(m.examMode_submitEndFailed());
        ending = false;
        return;
      }
      await goto(`/exams/${timer.examId}`);
    } catch {
      toasts.error(m.examMode_submitEndFailed());
      ending = false;
    }
  }
</script>

<div class="ml-auto flex shrink-0 items-center gap-2 text-caption">
  <span class="text-muted-foreground">
    {timer.type === "exam" ? m.examMode_countdownLabel() : m.contests_timeLeft()}
  </span>
  <span class="font-mono font-semibold tabular-nums {urgencyClass}">{countdown}</span>
  {#if timer.type === "exam"}
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-sm border border-destructive/35 px-2 py-1 font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
      disabled={ending}
      onclick={() => void endExam()}
    >
      <X class="size-3.5" aria-hidden="true" />
      {m.examMode_submitEndButton()}
    </button>
  {/if}
</div>
