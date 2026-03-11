<script lang="ts">
  import { page } from "$app/stores";
  import { locale } from "svelte-i18n";
  import Header from "$lib/components/Header.svelte";

  let { children } = $props();

  $effect(() => {
    const routeLocale = $page.data.locale as string;
    if (routeLocale) {
      locale.set(routeLocale);
    }
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
