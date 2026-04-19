<script lang="ts">
  import { Button } from "$lib/components/ui/button";
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
  // Empty string sentinel = "General (not about a specific problem)".
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
      // TODO i18n Task 12
      toasts.success("Question posted");
    } catch (err) {
      // TODO i18n Task 12
      toasts.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      busy = false;
    }
  }
</script>

<section
  class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-5 space-y-3"
>
  <!-- TODO i18n Task 12 -->
  <h3 class="font-display text-title-sm font-medium">Ask a question</h3>

  {#if problems.length > 0}
    <label class="block space-y-1.5">
      <!-- TODO i18n Task 12 -->
      <span class="text-caption font-medium text-muted-foreground"
        >About problem (optional)</span
      >
      <select
        bind:value={selectedProblemId}
        disabled={busy}
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-body focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <!-- TODO i18n Task 12 -->
        <option value="">General (not about a specific problem)</option>
        {#each problems as p (p.id)}
          <option value={p.id}>{p.title}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label class="block space-y-1.5">
    <!-- TODO i18n Task 12 -->
    <span class="text-caption font-medium text-muted-foreground">Your question</span>
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
        <!-- TODO i18n Task 12 -->
        <span class="text-destructive">Question must be at least 10 characters</span>
      {:else if tooLong}
        <!-- TODO i18n Task 12 -->
        <span class="text-destructive">Question must be 1000 characters or less</span>
      {/if}
    </div>
  </label>

  <div class="flex items-center justify-end">
    <Button type="button" size="sm" disabled={!canSubmit} onclick={submit}>
      <!-- TODO i18n Task 12 -->
      Post question
    </Button>
  </div>
</section>
