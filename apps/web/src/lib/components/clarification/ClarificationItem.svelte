<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils.js";
  import { m } from "$lib/paraglide/messages.js";
  import type { ClarificationItem } from "$lib/stores/clarifications.svelte";
  import ClarificationStaffPanel from "./ClarificationStaffPanel.svelte";
  import type { ClarificationsStore } from "$lib/stores/clarifications.svelte";

  interface Props {
    item: ClarificationItem;
    canAnswer: boolean;
    store: ClarificationsStore;
    problems: { id: string; title: string }[];
  }

  let { item, canAnswer, store, problems }: Props = $props();

  const problemTitle = $derived(
    item.problemId ? (problems.find((p) => p.id === item.problemId)?.title ?? null) : null
  );

  // Render-time relative timestamp. Not reactive to clock tick — cheap
  // approximation for a low-frequency feed; re-computes on every SSE
  // update anyway.
  // Relative-time copy is locale-agnostic by design (follows the same
  // `Ns / Nm / Nh / Nd` pattern used by NotificationItem); not wired to
  // paraglide to keep the unit labels untranslated but consistent.
  function renderRelative(iso: string): string {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  const stateVariant = $derived<"info" | "success" | "muted">(
    item.state === "pending" ? "info" : item.state === "answered" ? "success" : "muted"
  );
  const stateLabel = $derived(
    item.state === "pending"
      ? m.clarification_state_pending()
      : item.state === "answered"
        ? m.clarification_state_answered()
        : m.clarification_state_dismissed()
  );

  const askerLabel = $derived(
    item.askedBy ? `@${item.askedBy.username}` : m.clarification_author_anonymous()
  );
</script>

<article
  id={`clarification-${item.id}`}
  class={cn(
    "rounded-xl border border-border bg-[color:var(--color-panel)] p-3",
    item.state === "dismissed" && "opacity-60"
  )}
>
  <header class="flex flex-wrap items-center gap-3">
    <Badge variant={stateVariant} size="sm">{stateLabel}</Badge>
    <span class="text-body-sm font-medium text-foreground">{askerLabel}</span>
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span class="text-caption text-muted-foreground">{renderRelative(item.createdAt)}</span>
    {#if problemTitle}
      <span
        class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
        aria-hidden="true"
      ></span>
      <Badge variant="muted" size="sm"
        >{m.clarification_problemChip({ title: problemTitle })}</Badge
      >
    {/if}
  </header>

  <p class="mt-3 whitespace-pre-wrap text-body text-foreground">
    {item.questionText}
  </p>

  {#if item.answerText}
    <div class="mt-4 rounded-lg border border-border-subtle bg-[color:var(--color-panel-strong)] p-2">
      <p class="whitespace-pre-wrap text-body text-foreground">{item.answerText}</p>
      {#if item.answeredBy}
        <p class="mt-2 text-caption text-muted-foreground">
          {m.clarification_answerBy({ name: item.answeredBy.name })}
          {#if item.answeredAt}
            · {renderRelative(item.answeredAt)}
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  {#if canAnswer && item.state === "pending"}
    <div class="mt-4 border-t border-border-subtle pt-4">
      <ClarificationStaffPanel {item} {store} />
    </div>
  {/if}
</article>
