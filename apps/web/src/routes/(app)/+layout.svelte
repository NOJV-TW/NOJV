<script lang="ts">
  import "../../app.css";
  import Header from "$lib/components/layout/Header.svelte";

  let { children } = $props();
</script>

<div
  class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8"
>
  <Header />
  <main class="flex-1 pt-6">
    {@render children()}
  </main>
</div>
