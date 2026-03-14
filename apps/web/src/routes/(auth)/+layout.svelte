<script lang="ts">
  import Header from "$lib/components/layout/Header.svelte";

  let { children } = $props();
</script>

<div class="min-h-screen bg-gradient-to-br from-stone-50 to-orange-50/40 px-4">
  <div class="mx-auto max-w-7xl pt-4">
    <Header />
  </div>
  <div class="flex min-h-[calc(100vh-6rem)] items-center justify-center">
    {@render children()}
  </div>
</div>
