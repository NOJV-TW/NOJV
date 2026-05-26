<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/state";
  import Header from "$lib/components/features/layout/Header.svelte";
  import Footer from "$lib/components/primitives/layout/Footer.svelte";
  import { notifications } from "$lib/stores/notifications.svelte";
  import { connectSSE, disconnectSSE } from "$lib/stores/sse";

  let { children } = $props();
  let user = $derived(page.data.user);

  onMount(() => {
    connectSSE();
  });

  onDestroy(() => {
    disconnectSSE();
  });

  // Load recent notifications once per authenticated session. The `$effect`
  // re-fires only if `user?.id` changes (login/logout), not on every re-render.
  let initedFor: string | null = null;
  $effect(() => {
    const id = user?.id ?? null;
    if (id && id !== initedFor) {
      initedFor = id;
      void notifications.init();
    }
  });
</script>

<div
  class="mx-auto flex min-h-dvh w-full max-w-screen-2xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8"
>
  <Header />
  <main class="flex-1 pt-6">
    {@render children?.()}
  </main>
  <Footer />
</div>
