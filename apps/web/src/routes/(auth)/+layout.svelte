<script lang="ts">
  import Header from "$lib/components/features/layout/Header.svelte";
  import Footer from "$lib/components/primitives/layout/Footer.svelte";

  let { children } = $props();
</script>

<svelte:head>
  <title>NOJV</title>
</svelte:head>

<div class="flex min-h-dvh flex-col">
  <Header />
  <div class="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-4 pb-10 sm:px-6 lg:px-8">
    <div class="flex flex-1 items-center justify-center py-10">
      {@render children?.()}
    </div>
    <Footer />
  </div>
</div>
