<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { SSE_CLARIFICATION, type SSEEvent } from "@nojv/core";
  import {
    createClarificationsStore,
    type ClarificationsStore,
  } from "$lib/stores/clarifications.svelte";
  import {
    onSSEEvent,
    subscribeClarificationChannel,
    unsubscribeClarificationChannel,
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

  let store: ClarificationsStore | null = $state(null);
  let sseUnsubscribe: (() => void) | null = null;

  onMount(() => {
    const s = createClarificationsStore(contextType, contextId);
    store = s;
    void s.init();
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
