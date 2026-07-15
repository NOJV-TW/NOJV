<script lang="ts">
  import { SSE_CLARIFICATION, type SSEEvent } from "@nojv/core";
  import {
    createClarificationsStore,
    type ClarificationsStore,
  } from "$lib/stores/clarifications.svelte";
  import { onSSEEvent, subscribeClarificationChannel } from "$lib/stores/sse";
  import ClarificationAskForm from "./ClarificationAskForm.svelte";
  import ClarificationList from "./ClarificationList.svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    contextType: "contest" | "exam" | "assignment";
    contextId: string;
    canAsk: boolean;
    canAnswer: boolean;
    problems: { id: string; title: string }[];
  }

  let { contextType, contextId, canAsk, canAnswer, problems }: Props = $props();

  let store: ClarificationsStore | null = $state(null);
  let loadError = $state<string | null>(null);

  $effect(() => {
    const capturedType = contextType;
    const capturedId = contextId;
    const controller = new AbortController();
    let active = true;
    const s = createClarificationsStore(capturedType, capturedId);
    store = s;
    loadError = null;
    const releaseChannel = subscribeClarificationChannel(capturedType, capturedId);

    const releaseListener = onSSEEvent(SSE_CLARIFICATION, (event: SSEEvent) => {
      if (!active || event.type !== SSE_CLARIFICATION) return;
      s.handleSse(event);
    });

    s.markTabVisited();
    void s.init(controller.signal).catch(() => {
      if (!controller.signal.aborted && active) {
        loadError = m.clarification_toastError();
      }
    });

    return () => {
      active = false;
      controller.abort();
      releaseListener();
      releaseChannel();
      if (store === s) store = null;
      loadError = null;
    };
  });
</script>

<div class="space-y-6">
  {#if loadError}
    <div
      role="alert"
      class="rounded-md bg-destructive/10 px-3 py-2 text-body-sm text-destructive"
    >
      {loadError}
    </div>
  {/if}
  {#if store}
    {#if canAsk}
      <ClarificationAskForm {store} {problems} />
    {/if}
    <ClarificationList {store} {canAnswer} {problems} />
  {/if}
</div>
