<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { X } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { m } from "$lib/paraglide/messages.js";

  export interface MobileNavLink {
    href: string;
    label: string;
    icon: Component;
    active: boolean;
  }

  interface Props {
    open: boolean;
    items: MobileNavLink[];
    onclose: () => void;
  }

  let { open, items, onclose }: Props = $props();

  const uid = $props.id();

  let closeButton = $state<HTMLButtonElement | null>(null);

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      onclose();
    }
  }

  $effect(() => {
    if (open) closeButton?.focus();
  });
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-[var(--z-modal)] cursor-default bg-background/50 backdrop-blur-[1px] lg:hidden"
    aria-label={m.common_close()}
    onclick={onclose}
    transition:fade={{ duration: 120 }}
  ></button>

  <div
    id={uid}
    class="fixed inset-y-0 left-0 z-[var(--z-modal)] flex w-72 max-w-[80vw] flex-col overflow-hidden border-r border-border bg-[color:var(--color-panel-strong)] shadow-modal backdrop-blur-md lg:hidden"
    role="dialog"
    aria-modal="true"
    aria-label={m.nav_menuHeading()}
    transition:fly={{ x: -288, duration: 220, easing: cubicOut }}
  >
    <header class="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-4">
      <span class="text-title-sm font-bold tracking-tight">NOJV</span>
      <button
        bind:this={closeButton}
        type="button"
        class="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
        aria-label={m.common_close()}
        onclick={onclose}
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </header>

    <nav class="flex-1 overflow-y-auto px-3 py-3">
      {#each items as item (item.href)}
        {@const Icon = item.icon}
        <a
          class="mb-1 flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft {item.active
            ? 'bg-accent/60 text-foreground'
            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          onclick={onclose}
        >
          <Icon class="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>
{/if}
