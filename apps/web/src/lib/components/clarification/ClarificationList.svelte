<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { ClarificationsStore } from "$lib/stores/clarifications.svelte";
  import ClarificationItem from "./ClarificationItem.svelte";

  interface Props {
    store: ClarificationsStore;
    canAnswer: boolean;
    problems: { id: string; title: string }[];
  }

  let { store, canAnswer, problems }: Props = $props();

  // Sort: pending → answered → dismissed, then newest first within each bucket.
  // Staff see pending at the top so they can triage; students see the same
  // ordering so they can track their outstanding questions.
  const sorted = $derived.by(() => {
    const stateRank = (s: "pending" | "answered" | "dismissed"): number =>
      s === "pending" ? 0 : s === "answered" ? 1 : 2;
    return [...store.items].sort((a, b) => {
      const sr = stateRank(a.state) - stateRank(b.state);
      if (sr !== 0) return sr;
      return b.createdAt.localeCompare(a.createdAt);
    });
  });

  const counts = $derived({
    pending: store.items.filter((i) => i.state === "pending").length,
    answered: store.items.filter((i) => i.state === "answered").length,
    dismissed: store.items.filter((i) => i.state === "dismissed").length
  });
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-4 text-caption text-muted-foreground tabular-nums">
    <span>{m.clarification_count_pending({ count: counts.pending })}</span>
    <span>{m.clarification_count_answered({ count: counts.answered })}</span>
    <span>{m.clarification_count_dismissed({ count: counts.dismissed })}</span>
  </div>

  {#if sorted.length === 0}
    <div
      class="rounded-2xl border border-dashed border-border bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {m.clarification_empty()}
    </div>
  {:else}
    <div class="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
      {#each sorted as item (item.id)}
        <ClarificationItem {item} {canAnswer} {store} {problems} />
      {/each}
    </div>
  {/if}
</div>
