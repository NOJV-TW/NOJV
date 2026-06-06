<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";
</script>

<svelte:head>
  <title>{m.legal_privacyTitle()} · NOJV</title>
</svelte:head>

<div class="legal-prose mx-auto w-full max-w-3xl pt-6">
  <h1 class="text-title-lg font-bold leading-tight text-foreground sm:text-display">
    {m.legal_privacyTitle()}
  </h1>
  <p class="mt-3 text-caption text-muted-foreground">{m.legal_lastUpdated()}</p>
  <div class="mt-10 text-muted-foreground">
    <MarkdownRenderer content={m.legal_privacyContent()} />
  </div>
</div>
