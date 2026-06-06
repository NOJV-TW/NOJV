<script lang="ts">
  import Header from "$lib/components/features/layout/Header.svelte";
  import Footer from "$lib/components/primitives/layout/Footer.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { children, data } = $props();
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-screen-2xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
  <a
    href="#main-content"
    class="sr-only z-[var(--z-toast)] rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-modal focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
  >
    {m.a11y_skipToContent()}
  </a>
  <Header />
  <main id="main-content" tabindex="-1" class="flex-1 pt-6 outline-none">
    {@render children?.()}
  </main>
  <Footer repoUrl={data.repoUrl} />
</div>
