<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { toasts } from "$lib/stores/toast";
  import type {
    ClarificationItem,
    ClarificationsStore
  } from "$lib/stores/clarifications.svelte";

  interface Props {
    item: ClarificationItem;
    store: ClarificationsStore;
  }

  let { item, store }: Props = $props();

  let answerText = $state("");
  let busy = $state(false);

  const ANSWER_MIN = 1;
  const ANSWER_MAX = 1000;
  const charCount = $derived(answerText.length);
  const canSubmit = $derived(
    !busy && charCount >= ANSWER_MIN && charCount <= ANSWER_MAX
  );

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    try {
      await store.answer(item.id, answerText);
      answerText = "";
      // TODO i18n Task 12
      toasts.success("Answer posted");
    } catch (err) {
      // TODO i18n Task 12
      toasts.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      busy = false;
    }
  }

  async function sendCanned(key: "noComment" | "readProblem" | "yes" | "no") {
    busy = true;
    try {
      await store.canned(item.id, key);
      // TODO i18n Task 12
      toasts.success("Answer posted");
    } catch (err) {
      // TODO i18n Task 12
      toasts.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      busy = false;
    }
  }

  async function handleDismiss() {
    busy = true;
    try {
      await store.dismiss(item.id);
      // TODO i18n Task 12
      toasts.info("Marked as dismissed");
    } catch (err) {
      // TODO i18n Task 12
      toasts.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-3">
  <!-- TODO i18n Task 12 -->
  <div class="text-caption font-medium uppercase tracking-wide text-muted-foreground">
    Quick replies
  </div>
  <div class="flex flex-wrap gap-2">
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("noComment")}
    >
      <!-- TODO i18n Task 12 -->
      No comment.
    </Button>
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("readProblem")}
    >
      <!-- TODO i18n Task 12 -->
      Please re-read the problem statement.
    </Button>
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("yes")}
    >
      <!-- TODO i18n Task 12 -->
      Yes.
    </Button>
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("no")}
    >
      <!-- TODO i18n Task 12 -->
      No.
    </Button>
  </div>

  <label class="block space-y-1.5">
    <!-- TODO i18n Task 12 -->
    <span class="text-caption font-medium text-muted-foreground">Your answer</span>
    <textarea
      bind:value={answerText}
      rows={3}
      maxlength={ANSWER_MAX}
      class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-body focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      disabled={busy}
    ></textarea>
    <div class="text-caption text-muted-foreground tabular-nums">
      {charCount} / {ANSWER_MAX}
    </div>
  </label>

  <div class="flex flex-wrap items-center justify-end gap-2">
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={handleDismiss}
    >
      <!-- TODO i18n Task 12 -->
      Dismiss
    </Button>
    <Button type="button" size="sm" disabled={!canSubmit} onclick={submit}>
      <!-- TODO i18n Task 12 -->
      Send answer
    </Button>
  </div>
</div>
