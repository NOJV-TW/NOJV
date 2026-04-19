<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils.js";
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
  function renderRelative(iso: string): string {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`; // TODO i18n Task 12
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
    // TODO i18n Task 12
    item.state === "pending" ? "Pending" : item.state === "answered" ? "Answered" : "Dismissed"
  );

  const askerLabel = $derived(
    // TODO i18n Task 12
    item.askedBy ? `@${item.askedBy.username}` : "Anonymous"
  );
</script>

<article
  id={`clarification-${item.id}`}
  class={cn(
    "rounded-2xl border border-border bg-[color:var(--color-panel)] p-5",
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
      <!-- TODO i18n Task 12 -->
      <Badge variant="muted" size="sm">Problem: {problemTitle}</Badge>
    {/if}
  </header>

  <p class="mt-3 whitespace-pre-wrap text-body text-foreground">
    {item.questionText}
  </p>

  {#if item.answerText}
    <div class="mt-4 rounded-xl border border-border-subtle bg-[color:var(--color-panel-strong)] p-4">
      <p class="whitespace-pre-wrap text-body text-foreground">{item.answerText}</p>
      {#if item.answeredBy}
        <p class="mt-2 text-caption text-muted-foreground">
          <!-- TODO i18n Task 12 -->
          Answered by {item.answeredBy.name}
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
