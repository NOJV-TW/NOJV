<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/state";
  import Header from "$lib/components/features/layout/Header.svelte";
  import Footer from "$lib/components/primitives/layout/Footer.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { notifications } from "$lib/stores/notifications.svelte";
  import { connectSSE, disconnectSSE } from "$lib/stores/sse";

  let { children } = $props();
  let user = $derived(page.data.user);

  let immersive = $derived(page.route.id?.endsWith("/problems/[problemId]") ?? false);

  onMount(() => {
    connectSSE();
  });

  onDestroy(() => {
    disconnectSSE();
  });

  let initedFor: string | null = null;
  $effect(() => {
    const id = user?.id ?? null;
    if (id && id !== initedFor) {
      initedFor = id;
      void notifications.init();
    }
  });
</script>

<div class="flex flex-col {immersive ? 'h-dvh overflow-hidden' : 'min-h-dvh'}">
  <a
    href="#main-content"
    class="sr-only z-[var(--z-toast)] rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-modal focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
  >
    {m.a11y_skipToContent()}
  </a>
  <Header {immersive} />
  <div
    class="mx-auto flex w-full max-w-screen-2xl flex-col px-4 sm:px-6 lg:px-8 {immersive
      ? 'min-h-0 flex-1 pb-4'
      : 'flex-1 pb-10'}"
  >
    <main
      id="main-content"
      tabindex="-1"
      class="outline-none {immersive ? 'min-h-0 flex-1 pt-4' : 'flex-1 pt-8'}"
    >
      {@render children?.()}
    </main>
    {#if !immersive}
      <Footer />
    {/if}
  </div>
</div>
