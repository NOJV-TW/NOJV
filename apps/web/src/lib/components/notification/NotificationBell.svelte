<script lang="ts">
  import BellIcon from "@lucide/svelte/icons/bell";
  import { m } from "$lib/paraglide/messages.js";
  import { notifications } from "$lib/stores/notifications.svelte";
  import { cn } from "$lib/utils.js";
  import NotificationDropdown from "./NotificationDropdown.svelte";

  let open = $state(false);
  let btnEl: HTMLButtonElement | undefined = $state();
  let dropdownEl: HTMLDivElement | undefined = $state();

  function handleClickOutside(e: MouseEvent) {
    if (btnEl?.contains(e.target as Node) || dropdownEl?.contains(e.target as Node)) {
      return;
    }
    open = false;
  }

  $effect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  });

  let displayCount = $derived(
    notifications.unreadCount > 99 ? "99+" : String(notifications.unreadCount)
  );
</script>

<div class="relative">
  <button
    bind:this={btnEl}
    aria-expanded={open}
    aria-haspopup="menu"
    aria-label={m.notification_bell_ariaLabel()}
    class={cn(
      "relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-[color:var(--color-panel-strong)] text-foreground transition-[transform,box-shadow] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover",
      notifications.isAnimating && "bell-shake"
    )}
    onclick={() => (open = !open)}
    type="button"
  >
    <BellIcon size={18} />
    {#if notifications.unreadCount > 0}
      <span
        class="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
        aria-label={m.notification_bell_unreadCount({ count: notifications.unreadCount })}
      >
        {displayCount}
      </span>
    {/if}
  </button>

  {#if open}
    <div
      bind:this={dropdownEl}
      class="absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-modal backdrop-blur-sm"
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
</style>
