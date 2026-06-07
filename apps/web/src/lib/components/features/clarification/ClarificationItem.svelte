<script lang="ts">
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css.js";
  import { relativeTime } from "$lib/utils/relative-time";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
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

  let deleting = $state(false);

  async function handleDelete() {
    if (deleting) return;
    if (!confirm(m.clarification_deleteConfirm())) return;
    deleting = true;
    try {
      await store.delete(item.id);
      toasts.success(m.clarification_toastDeleted());
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.clarification_toastError());
    } finally {
      deleting = false;
    }
  }

  const problemTitle = $derived(
    item.problemId ? (problems.find((p) => p.id === item.problemId)?.title ?? null) : null,
  );

  const stateVariant = $derived<"info" | "success" | "muted">(
    item.state === "pending" ? "info" : item.state === "answered" ? "success" : "muted",
  );
  const stateLabel = $derived(
    item.state === "pending"
      ? m.clarification_state_pending()
      : item.state === "answered"
        ? m.clarification_state_answered()
        : m.clarification_state_dismissed(),
  );

  const askerLabel = $derived(
    item.askedBy ? `@${item.askedBy.username}` : m.clarification_author_anonymous(),
  );
</script>

<article
  id={`clarification-${item.id}`}
  class={cn(
    "rounded-xl border border-border bg-[color:var(--color-panel)] p-3",
    item.state === "dismissed" && "opacity-60",
  )}
>
  <header class="flex flex-wrap items-center gap-3">
    <Badge variant={stateVariant} size="sm">{stateLabel}</Badge>
    <span class="text-body-sm font-medium text-foreground">{askerLabel}</span>
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span class="text-caption text-muted-foreground">{relativeTime(item.createdAt)}</span>
    {#if problemTitle}
      <span
        class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
        aria-hidden="true"
      ></span>
      <Badge variant="muted" size="sm"
        >{m.clarification_problemChip({ title: problemTitle })}</Badge
      >
    {/if}
    {#if canAnswer}
      <Button
        variant="ghost"
        size="sm"
        type="button"
        class="ml-auto text-destructive"
        disabled={deleting}
        onclick={handleDelete}
      >
        {m.clarification_deleteBtn()}
      </Button>
    {/if}
  </header>

  <p class="mt-3 whitespace-pre-wrap text-body text-foreground">
    {item.questionText}
  </p>

  {#if item.answerText}
    <div
      class="mt-4 rounded-lg border border-border-subtle bg-[color:var(--color-panel-strong)] p-2"
    >
      <p class="whitespace-pre-wrap text-body text-foreground">{item.answerText}</p>
      {#if item.answeredBy}
        <p class="mt-2 text-caption text-muted-foreground">
          {m.clarification_answerBy({ name: item.answeredBy.name })}
          {#if item.answeredAt}
            · {relativeTime(item.answeredAt)}
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
