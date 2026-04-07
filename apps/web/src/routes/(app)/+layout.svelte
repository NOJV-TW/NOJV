<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Header from "$lib/components/layout/Header.svelte";
  import { connectSSE, disconnectSSE } from "$lib/stores/sse";

  let { children } = $props();

  onMount(() => {
    connectSSE();
  });

  onDestroy(() => {
    disconnectSSE();
  });
</script>

<div
  class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8"
>
  <Header />
  <main class="flex-1 pt-6">
    {@render children()}
  </main>
</div>
