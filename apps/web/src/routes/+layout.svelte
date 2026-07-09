<script lang="ts">
  import "../app.css";
  import { m } from "$lib/paraglide/messages.js";
  import ToastProvider from "$lib/components/primitives/ui/ToastProvider.svelte";
  import { useGlobalShortcuts } from "$lib/stores/shortcuts.svelte.js";
  import { onNavigate } from "$app/navigation";
  import { navigating } from "$app/state";

  let { children } = $props();

  useGlobalShortcuts();

  let showProgress = $state(false);

  $effect(() => {
    if (!navigating.to) {
      showProgress = false;
      return;
    }
    const timer = setTimeout(() => {
      showProgress = true;
    }, 150);
    return () => clearTimeout(timer);
  });

  onNavigate((navigation) => {
    if (
      !document.startViewTransition ||
      navigation.to?.route.id === navigation.from?.route.id
    ) {
      return;
    }
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>

<svelte:head>
  <title>NOJV</title>
  <meta property="og:site_name" content="NOJV" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="NOJV" />
  <meta property="og:description" content={m.home_productDescription()} />
  <meta property="og:image" content="https://nojv.tw/og.png" />
  <meta property="og:image:width" content="2400" />
  <meta property="og:image:height" content="1260" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{#if showProgress}
  <div class="nav-progress" aria-hidden="true">
    <span class="nav-progress__bar bg-primary"></span>
  </div>
{/if}

{@render children()}

<ToastProvider />

<style>
  .nav-progress {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 100;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
  }

  .nav-progress__bar {
    display: block;
    height: 100%;
    width: 40%;
    border-radius: 9999px;
    animation: nav-progress-slide 1.1s ease-in-out infinite;
  }

  @keyframes nav-progress-slide {
    0% {
      transform: translateX(-120%);
    }
    100% {
      transform: translateX(360%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-progress__bar {
      width: 100%;
      animation: none;
    }
  }
</style>
