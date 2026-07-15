<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import { fetchWithCsrf } from "$lib/services/http";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import { nextMenuItemIndex, type MenuNavigationKey } from "$lib/utils/menu-focus";

  let user = $derived(page.data.user);
  let session = $derived(page.data.session);
  let canActAsAdmin = $derived(user?.platformRole === "admin");
  let actingAsAdmin = $derived(page.data.actingAsAdmin ?? false);
  let adminBusy = $state(false);
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
  });

  async function toggleAdminMode() {
    if (adminBusy) return;
    adminBusy = true;
    const active = !actingAsAdmin;
    try {
      const r = await fetchWithCsrf("/api/admin-mode", {
        method: "POST",
        body: JSON.stringify({ active }),
      });
      if (!r.ok) {
        open = false;
        if (active && user?.isSuperAdmin && r.status === 403) {
          await goto("/account/api-tokens/verify?purpose=admin-mode");
        }
        return;
      }
      open = false;
      await invalidateAll();
      if (active) {
        await goto("/admin");
      } else if (page.url.pathname.startsWith("/admin")) {
        await goto("/dashboard");
      }
    } finally {
      adminBusy = false;
    }
  }

  let open = $state(false);
  const menuId = $props.id();
  const menuTriggerId = `${menuId}-trigger`;
  const menuContentId = `${menuId}-content`;
  let btnEl: HTMLButtonElement | undefined = $state();
  let dropdownEl: HTMLDivElement | undefined = $state();

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
      return;
    }
    if (
      !(["ArrowDown", "ArrowUp", "Home", "End"] as const).includes(e.key as MenuNavigationKey)
    ) {
      return;
    }
    const items = [...(dropdownEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const nextIndex = nextMenuItemIndex(e.key as MenuNavigationKey, currentIndex, items.length);
    if (nextIndex === null) return;
    e.preventDefault();
    items[nextIndex]?.focus();
  }

  function handleTriggerKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    open = true;
    queueMicrotask(() => {
      const items = [...(dropdownEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const index = e.key === "ArrowUp" ? items.length - 1 : 0;
      items[index]?.focus();
    });
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

  async function handleSignOut() {
    await authClient.signOut();
    open = false;
    await invalidateAll();
    await goto("/");
  }
</script>

{#if session && user}
  {@const initial = (user.name.charAt(0) || "?").toUpperCase()}
  {@const hasUsername = !!user.username}

  <div class="relative">
    <button
      bind:this={btnEl}
      id={menuTriggerId}
      class="flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-primary text-body-sm font-semibold text-primary-foreground shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover hover:opacity-90"
      onclick={() => (open = !open)}
      onkeydown={handleTriggerKeydown}
      disabled={!hydrated}
      title={user.name}
      type="button"
      aria-label={m.userMenu_openAccountMenu({ name: user.name })}
      aria-haspopup="menu"
      aria-controls={menuContentId}
      aria-expanded={open}
    >
      {#if user.image}
        <img src={user.image} alt={user.name} class="size-full object-cover" />
      {:else}
        {initial}
      {/if}
    </button>

    {#if open}
      <div
        bind:this={dropdownEl}
        id={menuContentId}
        role="menu"
        aria-labelledby={menuTriggerId}
        class="absolute right-0 top-full z-50 mt-2 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-modal backdrop-blur-sm"
      >
        {#if hasUsername}
          <a
            class="flex items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-fast ease-out-soft hover:bg-accent"
            href="/users/{user.id}"
            role="menuitem"
            aria-label={m.userMenu_profile()}
            onclick={() => (open = false)}
          >
            <span
              class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border-subtle bg-primary text-body-sm font-semibold text-primary-foreground"
            >
              {#if user.image}
                <img src={user.image} alt={user.name} class="size-full object-cover" />
              {:else}
                {initial}
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body-sm font-semibold">{user.name}</span>
              <span class="block truncate text-caption text-muted-foreground"
                >@{user.username}</span
              >
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              class="size-4 shrink-0 text-muted-foreground"
            />
          </a>
        {:else}
          <div class="border-b border-border-subtle px-4 py-2.5">
            <p class="truncate text-body-sm font-medium">{user.name}</p>
            <p class="truncate text-caption text-muted-foreground">{user.email}</p>
          </div>
        {/if}

        {#if hasUsername}
          <a
            class="flex items-center gap-2 px-4 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
            href="/settings"
            role="menuitem"
            onclick={() => (open = false)}
          >
            <SettingsIcon aria-hidden="true" size={16} />
            {m.navigation_settings()}
          </a>

          <a
            class="flex items-center gap-2 px-4 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
            href="/account/api-tokens"
            role="menuitem"
            onclick={() => (open = false)}
          >
            <KeyRoundIcon aria-hidden="true" size={16} />
            {m.userMenu_apiTokens()}
          </a>
        {/if}

        {#if canActAsAdmin}
          <button
            class="flex w-full items-center gap-2 px-4 py-2 text-left text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            class:text-primary={actingAsAdmin}
            onclick={toggleAdminMode}
            disabled={adminBusy}
            type="button"
            role="menuitem"
          >
            <ShieldIcon aria-hidden="true" size={16} />
            {actingAsAdmin ? m.userMenu_exitAdminMode() : m.userMenu_enterAdminMode()}
          </button>
        {/if}

        <button
          class="flex w-full items-center gap-2 px-4 py-2 text-left text-body-sm text-destructive transition-colors duration-fast ease-out-soft hover:bg-destructive/10"
          onclick={handleSignOut}
          type="button"
          role="menuitem"
        >
          <LogOutIcon aria-hidden="true" size={16} />
          {m.auth_signOut()}
        </button>
      </div>
    {/if}
  </div>
{/if}
