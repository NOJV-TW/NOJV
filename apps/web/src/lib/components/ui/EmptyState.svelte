<script lang="ts">
  import type { Component } from "svelte";

  interface Props {
    icon: Component<{ class?: string }>;
    title: string;
    description?: string;
    actionHref?: string;
    actionLabel?: string;
  }

  let { icon: Icon, title, description, actionHref, actionLabel }: Props =
    $props();
</script>

<div class="flex flex-col items-center justify-center py-16 text-center">
  <div
    class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60"
  >
    <Icon class="h-7 w-7 text-muted-foreground/70" />
  </div>
  <h3 class="mt-4 text-lg font-semibold">{title}</h3>
  {#if description}
    <p class="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
  {/if}
  {#if actionHref && actionLabel}
    <a
      class="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
      href={actionHref}
    >
      {actionLabel}
    </a>
  {/if}
</div>
