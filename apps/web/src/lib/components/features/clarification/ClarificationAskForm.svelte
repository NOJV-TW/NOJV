<script lang="ts">
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import type { ClarificationsStore } from "$lib/stores/clarifications.svelte";

  interface Props {
    store: ClarificationsStore;
    problems: { id: string; title: string }[];
  }

  let { store, problems }: Props = $props();

  const QUESTION_MIN = 10;
  const QUESTION_MAX = 1000;

  let questionText = $state("");
  let selectedProblemId = $state("");
  let busy = $state(false);

  const charCount = $derived(questionText.length);
  const tooShort = $derived(charCount > 0 && charCount < QUESTION_MIN);
  const tooLong = $derived(charCount > QUESTION_MAX);
  const canSubmit = $derived(!busy && charCount >= QUESTION_MIN && charCount <= QUESTION_MAX);

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    try {
      await store.ask(questionText, selectedProblemId ? selectedProblemId : null);
      questionText = "";
      selectedProblemId = "";
      toasts.success(m.clarification_toastPosted());
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.clarification_toastError());
    } finally {
      busy = false;
    }
  }
</script>

<section
  class="rounded-xl border border-border bg-[color:var(--color-panel)] p-3 space-y-3"
>
  <h3 class="text-title-sm font-medium">{m.clarification_askBtn()}</h3>

  {#if problems.length > 0}
    <label class="block space-y-1.5">
      <span class="text-caption font-medium text-muted-foreground"
        >{m.clarification_ask_problemLabel()}</span
      >
      <select
        bind:value={selectedProblemId}
        disabled={busy}
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-body focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">{m.clarification_ask_problemGeneral()}</option>
        {#each problems as p (p.id)}
          <option value={p.id}>{p.title}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label class="block space-y-1.5">
    <span class="text-caption font-medium text-muted-foreground"
      >{m.clarification_ask_questionLabel()}</span
    >
    <textarea
      bind:value={questionText}
      rows={4}
      maxlength={QUESTION_MAX}
      class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-body focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      disabled={busy}
    ></textarea>
    <div class="flex items-center justify-between text-caption">
      <span class="text-muted-foreground tabular-nums">
        {charCount} / {QUESTION_MAX}
      </span>
      {#if tooShort}
        <span class="text-destructive">{m.clarification_ask_questionMinError()}</span>
      {:else if tooLong}
        <span class="text-destructive">{m.clarification_ask_questionMaxError()}</span>
      {/if}
    </div>
  </label>

  <div class="flex items-center justify-end">
    <Button type="button" size="sm" disabled={!canSubmit} onclick={submit}>
      {m.clarification_ask_submitBtn()}
    </Button>
  </div>
</section>
