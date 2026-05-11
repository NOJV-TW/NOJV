<script lang="ts">
  import Header from "$lib/components/layout/Header.svelte";
  import Footer from "$lib/components/layout/Footer.svelte";

  let { children } = $props();
</script>

<svelte:head>
  <title>NOJV</title>
</svelte:head>

<div class="flex min-h-dvh flex-col px-4 pb-10 sm:px-6 lg:px-8">
  <div class="mx-auto w-full max-w-screen-2xl pt-4">
    <Header />
  </div>
  <div class="flex flex-1 items-center justify-center py-10">
    {@render children?.()}
  </div>
  <div class="mx-auto w-full max-w-screen-2xl">
    <Footer />
  </div>
</div>
