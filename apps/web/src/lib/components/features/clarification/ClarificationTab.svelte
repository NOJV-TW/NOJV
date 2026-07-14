<script lang="ts">
  import { SSE_CLARIFICATION, type SSEEvent } from "@nojv/core";
  import {
    createClarificationsStore,
    type ClarificationsStore,
  } from "$lib/stores/clarifications.svelte";
  import { onSSEEvent, subscribeClarificationChannel } from "$lib/stores/sse";
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

  $effect(() => {
    const capturedType = contextType;
    const capturedId = contextId;
    const controller = new AbortController();
    let active = true;
    const s = createClarificationsStore(capturedType, capturedId);
    store = s;
    const releaseChannel = subscribeClarificationChannel(capturedType, capturedId);

    const releaseListener = onSSEEvent(SSE_CLARIFICATION, (event: SSEEvent) => {
      if (!active || event.type !== SSE_CLARIFICATION) return;
      s.handleSse(event);
    });

    s.markTabVisited();
    void s.init(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) throw error;
    });

    return () => {
      active = false;
      controller.abort();
      releaseListener();
      releaseChannel();
      if (store === s) store = null;
    };
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
