<script lang="ts">
  import BellIcon from "@lucide/svelte/icons/bell";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { m } from "$lib/paraglide/messages.js";
  import { notifications } from "$lib/stores/notifications.svelte";
  import { cn } from "$lib/utils/css.js";
  import NotificationDropdown from "./NotificationDropdown.svelte";

  let open = $state(false);
  let btnEl: HTMLButtonElement | undefined = $state();
  let dropdownEl: HTMLDivElement | undefined = $state();
  let prefersReducedMotion = $state(false);

  $effect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  function toggle() {
    open = !open;
  }

  function handleClickOutside(e: MouseEvent) {
    if (btnEl?.contains(e.target as Node) || dropdownEl?.contains(e.target as Node)) {
      return;
    }
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      open = false;
      btnEl?.focus();
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeydown);
      dropdownEl?.querySelector<HTMLElement>("a[href], button:not([disabled])")?.focus();
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeydown);
      };
    }
  });

  let displayCount = $derived(
    notifications.unreadCount > 99 ? "99+" : String(notifications.unreadCount),
  );
</script>

<div class="relative">
  <button
    bind:this={btnEl}
    aria-expanded={open}
    aria-label={m.notification_bell_ariaLabel()}
    class={cn(
      "relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-[color:var(--color-panel-strong)] text-foreground transition-[transform,box-shadow] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover",
      notifications.isAnimating && "bell-shake",
    )}
    onclick={toggle}
    type="button"
  >
    <BellIcon aria-hidden="true" size={18} />
    {#if notifications.unreadCount > 0}
      <span
        class={cn(
          "absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground",
          notifications.isAnimating && "dot-pulse",
        )}
        aria-label={m.notification_bell_unreadCount({ count: notifications.unreadCount })}
      >
        {displayCount}
      </span>
    {/if}
  </button>

  {#if open}
    <div
      bind:this={dropdownEl}
      class="absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-modal backdrop-blur-sm"
      transition:fly={{ y: -6, duration: prefersReducedMotion ? 0 : 180, easing: cubicOut }}
    >
      <NotificationDropdown />
    </div>
  {/if}
</div>

<style>
  @keyframes bell-shake {
    0%,
    100% {
      transform: rotate(0);
    }
    20%,
    60% {
      transform: rotate(-8deg);
    }
    40%,
    80% {
      transform: rotate(8deg);
    }
  }

  :global(.bell-shake) {
    animation: bell-shake 450ms ease-in-out;
  }

  @keyframes dot-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
  }

  :global(.dot-pulse) {
    animation: dot-pulse 400ms ease-in-out;
  }
</style>
