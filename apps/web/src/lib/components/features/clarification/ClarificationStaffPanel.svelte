<script lang="ts">
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import type {
    ClarificationItem,
    ClarificationsStore,
  } from "$lib/stores/clarifications.svelte";

  interface Props {
    item: ClarificationItem;
    store: ClarificationsStore;
  }

  let { item, store }: Props = $props();

  let answerText = $state("");
  let busy = $state(false);
  let isPublic = $state(true);

  const ANSWER_MIN = 1;
  const ANSWER_MAX = 1000;
  const charCount = $derived(answerText.length);
  const canSubmit = $derived(!busy && charCount >= ANSWER_MIN && charCount <= ANSWER_MAX);

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    try {
      await store.answer(item.id, answerText, isPublic);
      answerText = "";
      toasts.success(m.clarification_toastAnswered());
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.clarification_toastError());
    } finally {
      busy = false;
    }
  }

  async function sendCanned(key: "noComment" | "readProblem" | "yes" | "no") {
    busy = true;
    try {
      await store.canned(item.id, key);
      toasts.success(m.clarification_toastAnswered());
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.clarification_toastError());
    } finally {
      busy = false;
    }
  }

  async function handleDismiss() {
    busy = true;
    try {
      await store.dismiss(item.id);
      toasts.info(m.clarification_toastDismissed());
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.clarification_toastError());
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-3">
  <div class="text-caption font-medium uppercase tracking-wide text-muted-foreground">
    {m.clarification_staff_cannedLabel()}
  </div>
  <div class="flex flex-wrap gap-2">
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("noComment")}
    >
      {m.clarification_template_noComment()}
    </Button>
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("readProblem")}
    >
      {m.clarification_template_readProblem()}
    </Button>
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("yes")}
    >
      {m.clarification_template_yes()}
    </Button>
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={busy}
      onclick={() => sendCanned("no")}
    >
      {m.clarification_template_no()}
    </Button>
  </div>

  <label class="block space-y-1.5">
    <span class="text-caption font-medium text-muted-foreground"
      >{m.clarification_staff_answerLabel()}</span
    >
    <textarea
      bind:value={answerText}
      rows={3}
      maxlength={ANSWER_MAX}
      class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-body focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      disabled={busy}></textarea>
    <div class="text-caption text-muted-foreground tabular-nums">
      {charCount} / {ANSWER_MAX}
    </div>
  </label>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <label
      class="flex cursor-pointer select-none items-center gap-2 text-caption text-muted-foreground"
    >
      <input
        type="checkbox"
        bind:checked={isPublic}
        class="size-4 rounded"
        style="accent-color: var(--primary);"
      />
      <span>{m.clarification_staff_publicToggle()}</span>
    </label>
    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" type="button" disabled={busy} onclick={handleDismiss}>
        {m.clarification_staff_dismissBtn()}
      </Button>
      <Button type="button" size="sm" disabled={!canSubmit} onclick={submit}>
        {m.clarification_staff_submitBtn()}
      </Button>
    </div>
  </div>
</div>
