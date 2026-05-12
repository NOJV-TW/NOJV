<script lang="ts">
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    examCode: string;
    examTitle: string;
    /** Remaining ms until the exam window closes. */
    remainMs: number;
    /** Whether auto-save has run at least once. */
    savedAt: string | null;
    onSubmit: () => void;
  }

  let { examCode, examTitle, remainMs, savedAt, onSubmit }: Props = $props();

  const remainSec = $derived(Math.max(0, Math.floor(remainMs / 1000)));
  const urgent = $derived(remainSec < 600);

  function pad2(n: number): string {
    return n < 10 ? `0${String(n)}` : String(n);
  }

  const hh = $derived(Math.floor(remainSec / 3600));
  const mm = $derived(Math.floor((remainSec % 3600) / 60));
  const ss = $derived(remainSec % 60);
</script>

<div
  class="flex flex-shrink-0 items-center gap-4 border-b border-border-subtle px-5 py-3"
  style="background: var(--panel-strong, var(--panel));"
>
  <div class="flex items-center gap-2">
    <TypeIcon kind="exam" size={16} />
    <span class="font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground">
      {examCode}
    </span>
    <span class="opacity-50">·</span>
    <span class="text-body font-semibold">{examTitle}</span>
  </div>

  <div class="ml-auto flex items-center gap-4">
    <div
      class="flex items-center gap-3 rounded-full px-4 py-1.5"
      style:background={urgent
        ? "color-mix(in oklab, var(--destructive) 16%, transparent)"
        : "var(--muted)"}
      style:border={urgent
        ? "1px solid color-mix(in oklab, var(--destructive) 40%, transparent)"
        : "1px solid var(--border-subtle)"}
    >
      <span
        class="size-1.5 rounded-full"
        style:background={urgent ? "oklch(0.55 0.2 27)" : "var(--primary)"}
      ></span>
      <span class="font-mono text-micro uppercase tracking-wider text-muted-foreground">{m.examTake_remainingLabel()}</span>
      <span
        class="font-mono text-title font-bold tabular-nums"
        style:color={urgent ? "oklch(0.55 0.2 27)" : undefined}
      >
        {pad2(hh)}:{pad2(mm)}:{pad2(ss)}
      </span>
    </div>
    {#if savedAt}
      <span class="hidden items-center gap-1.5 text-caption text-muted-foreground sm:flex">
        <span class="size-1.5 rounded-full bg-primary"></span>
        {m.examTake_autosavedAt({ at: savedAt })}
      </span>
    {/if}
    <button
      type="button"
      onclick={onSubmit}
      class="rounded-md bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground transition-opacity hover:opacity-95"
    >
      {m.examTake_submitButton()}
    </button>
  </div>
</div>
