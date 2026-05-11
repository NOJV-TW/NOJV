<script lang="ts" module>
  export interface ExamTopStripContext {
    examId: string;
    courseId: string;
    examTitle: string;
    courseLabel: string;
    /** ISO timestamp — countdown ticks toward this instant. */
    endsAt: string;
    userHandle: string;
    ipAddress: string;
  }
</script>

<script lang="ts">
  import { goto } from "$app/navigation";
  import { Lock, X } from "@lucide/svelte";

  import { m } from "$lib/paraglide/messages.js";
  import { formatIpForDisplay } from "$lib/utils/format-ip";

  interface Props {
    context: ExamTopStripContext;
  }

  let { context }: Props = $props();
  let displayIp = $derived(formatIpForDisplay(context.ipAddress));

  let now = $state(Date.now());
  let ending = $state(false);

  let endsAtMs = $derived(new Date(context.endsAt).getTime());

  $effect(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => {
      clearInterval(id);
    };
  });

  let remainingMs = $derived(Math.max(0, endsAtMs - now));

  function formatCountdown(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(mm)}:${pad(s)}`;
  }

  let countdown = $derived(formatCountdown(remainingMs));

  async function handleEnd(): Promise<void> {
    if (ending) return;
    if (!window.confirm(m.examMode_submitEndConfirm())) return;
    ending = true;
    try {
      const res = await fetch("/api/exam-session/end", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ examId: context.examId, reason: "submitted" })
      });
      if (!res.ok) {
        ending = false;
        window.alert(m.examMode_submitEndFailed());
        return;
      }
      await goto(`/exams/${context.examId}`);
    } catch {
      ending = false;
      window.alert(m.examMode_submitEndFailed());
    }
  }
</script>

<header
  class="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-primary/30 bg-gradient-to-r from-primary/10 to-primary/[0.03] px-4 py-2.5 shadow-rest sm:px-6 md:grid md:grid-cols-[auto_1fr_auto]"
>
  <!-- left accent bar -->
  <div class="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true"></div>

  <!-- Left: lock + course / exam label -->
  <div class="flex items-center gap-3 pl-1">
    <div
      class="flex size-[34px] items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_2px_6px_rgba(196,104,45,0.4)]"
      title={m.examMode_lockTooltip()}
      aria-label={m.examMode_lockTooltip()}
    >
      <Lock class="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
    </div>
    <div class="flex flex-col leading-tight">
      <span
        class="text-caption font-medium uppercase tracking-[0.06em] text-muted-foreground"
      >
        {context.courseLabel}
      </span>
      <span class="mt-px text-body-lg font-medium tracking-[-0.01em]">
        {context.examTitle}
      </span>
    </div>
  </div>

  <!-- Center: countdown -->
  <div class="flex items-center justify-center gap-6">
    <div class="flex items-baseline gap-2">
      <span
        class="text-caption font-semibold uppercase tracking-[0.1em] text-muted-foreground"
      >
        {m.examMode_countdownLabel()}
      </span>
      <span
        class="font-mono text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-primary"
        aria-live="polite"
        aria-atomic="true"
      >
        {countdown}
      </span>
    </div>
  </div>

  <!-- Right: handle + IP chip + submit-end button -->
  <div class="flex items-center gap-3.5">
    <div class="flex items-center gap-2 text-body-sm text-muted-foreground">
      <span>{context.userHandle}</span>
      <code
        class="rounded-xs border border-border bg-background/70 px-2 py-0.5 font-mono break-all"
        title={context.ipAddress}
      >
        {displayIp}
      </code>
    </div>
    <button
      type="button"
      disabled={ending}
      onclick={handleEnd}
      class="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/[0.08] px-4 py-2 text-body-sm font-semibold text-destructive transition-colors hover:border-destructive hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <X class="size-4" strokeWidth={1.75} aria-hidden="true" />
      {m.examMode_submitEndButton()}
    </button>
  </div>
</header>
