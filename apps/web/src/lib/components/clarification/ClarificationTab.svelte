<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { SSE_CLARIFICATION, type SSEEvent } from "@nojv/core";
  import {
    createClarificationsStore,
    type ClarificationsStore
  } from "$lib/stores/clarifications.svelte";
  import {
    onSSEEvent,
    subscribeClarificationChannel,
    unsubscribeClarificationChannel
  } from "$lib/stores/sse";
  import ClarificationAskForm from "./ClarificationAskForm.svelte";
  import ClarificationList from "./ClarificationList.svelte";

  interface Props {
    contextType: "contest" | "exam" | "assignment";
    contextId: string;
    canAsk: boolean;
    canAnswer: boolean;
    problems: { id: string; title: string }[];
  }

  let { contextType, contextId, canAsk, canAnswer, problems }: Props = $props();

  // Store is created lazily in onMount so the initial-value lint in
  // Svelte 5's runes does not flag reading `contextType` / `contextId`
  // during setup. In practice the caller never swaps these props
  // mid-mount, but keeping them out of the module scope is tidier.
  let store: ClarificationsStore | null = $state(null);
  let sseUnsubscribe: (() => void) | null = null;

  onMount(() => {
    const s = createClarificationsStore(contextType, contextId);
    store = s;
    void s.init();
    // Server-side channel subscribe: extend the EventSource URL so the
    // stream endpoint joins `clarification:{type}:{id}` in addition to
    // the user's personal channels. A reconnect is needed for the
    // EventSource to pick up the new query param.
    subscribeClarificationChannel(contextType, contextId);

    sseUnsubscribe = onSSEEvent(SSE_CLARIFICATION, (event: SSEEvent) => {
      if (event.type !== SSE_CLARIFICATION) return;
      s.handleSse(event);
    });

    s.markTabVisited();
  });

  onDestroy(() => {
    sseUnsubscribe?.();
    unsubscribeClarificationChannel(contextType, contextId);
  });
</script>

<div class="space-y-6">
  {#if store}
    {#if canAsk}
      <ClarificationAskForm {store} {problems} />
    {/if}
    <ClarificationList {store} {canAnswer} {problems} />
  {/if}
</div>
