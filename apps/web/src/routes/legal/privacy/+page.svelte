<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import Header from "$lib/components/features/layout/Header.svelte";
  import Footer from "$lib/components/primitives/layout/Footer.svelte";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
</script>

<svelte:head>
  <title>{m.legal_privacyTitle()} · NOJV</title>
</svelte:head>

<div
  class="mx-auto flex min-h-dvh w-full max-w-screen-2xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8"
>
  <Header />

  <main class="legal-prose mx-auto w-full max-w-3xl flex-1 pt-12">
    <h1 class="text-title-lg font-bold leading-tight text-foreground sm:text-display">
      {m.legal_privacyTitle()}
    </h1>
    <p class="mt-3 text-caption text-muted-foreground">{m.legal_lastUpdated()}</p>
    <div class="mt-10 text-muted-foreground">
      <MarkdownRenderer content={m.legal_privacyContent()} />
    </div>
  </main>

  <Footer />
</div>
