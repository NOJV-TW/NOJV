<script lang="ts">
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import { fetchWithCsrf } from "$lib/services/http";
  import UserIcon from "@lucide/svelte/icons/user";
  import SquareArrowOutUpRightIcon from "@lucide/svelte/icons/square-arrow-out-up-right";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";

  let user = $derived(page.data.user);
  let session = $derived(page.data.session);
  let canActAsAdmin = $derived(page.data.canActAsAdmin ?? false);
  let actingAsAdmin = $derived(page.data.actingAsAdmin ?? false);
  let adminBusy = $state(false);

  async function toggleAdminMode() {
    if (adminBusy) return;
    adminBusy = true;
    const next = !actingAsAdmin;
    try {
      const r = await fetchWithCsrf("/api/admin-mode", {
        method: "POST",
        body: JSON.stringify({ active: next }),
      });
      if (!r.ok) return;
      open = false;
      await invalidateAll();
      if (next) {
        await goto("/admin");
      } else if (page.url.pathname.startsWith("/admin")) {
        await goto("/dashboard");
      }
    } finally {
      adminBusy = false;
    }
  }

  let open = $state(false);
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
      class="flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-primary text-body-sm font-semibold text-primary-foreground shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover hover:opacity-90"
      onclick={() => (open = !open)}
      title={user.name}
      type="button"
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
        class="absolute right-0 top-full z-50 mt-2 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-modal backdrop-blur-sm"
      >
        <div class="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <div class="min-w-0 flex-1">
            <p class="truncate text-body-sm font-medium">{user.name}</p>
            <p class="truncate text-caption text-muted-foreground">
              {user.username ? `@${user.username}` : user.email}
            </p>
          </div>
          {#if hasUsername}
            <a
              class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
              href="/users/{user.id}"
              title={m.userMenu_profile()}
              aria-label={m.userMenu_profile()}
              onclick={() => (open = false)}
            >
              <SquareArrowOutUpRightIcon aria-hidden="true" size={15} />
            </a>
          {/if}
        </div>

        {#if hasUsername}
          <a
            class="flex items-center gap-2 px-4 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
            href="/account"
            onclick={() => (open = false)}
          >
            <UserIcon aria-hidden="true" size={16} />
            {m.navigation_account()}
          </a>

          <a
            class="flex items-center gap-2 px-4 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
            href="/settings"
            onclick={() => (open = false)}
          >
            <SettingsIcon aria-hidden="true" size={16} />
            {m.navigation_settings()}
          </a>

          <a
            class="flex items-center gap-2 px-4 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
            href="/account/api-tokens"
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
          >
            <ShieldIcon aria-hidden="true" size={16} />
            {actingAsAdmin ? m.userMenu_exitAdminMode() : m.userMenu_enterAdminMode()}
          </button>
        {/if}

        <button
          class="flex w-full items-center gap-2 px-4 py-2 text-left text-body-sm text-destructive transition-colors duration-fast ease-out-soft hover:bg-destructive/10"
          onclick={handleSignOut}
          type="button"
        >
          <LogOutIcon aria-hidden="true" size={16} />
          {m.auth_signOut()}
        </button>
      </div>
    {/if}
  </div>
{/if}
