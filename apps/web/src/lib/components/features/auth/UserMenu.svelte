<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import StepUpDialog from "$lib/components/features/account/StepUpDialog.svelte";
  import { fetchWithCsrf } from "$lib/services/http";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import { DropdownMenu } from "bits-ui";

  let user = $derived(page.data.user);
  let session = $derived(page.data.session);
  let canSwitchAdminMode = $derived(user?.platformRole === "admin" && !user.isSuperAdmin);
  let adminAccessActive = $derived(page.data.adminAccessActive ?? false);
  let adminBusy = $state(false);
  let apiTokenBusy = $state(false);
  let stepUpOpen = $state(false);
  let stepUpPurpose = $state<"admin-mode" | "api-tokens">("api-tokens");
  let hasPasskey = $state(false);
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
  });

  function verificationPath(purpose: "admin-mode" | "api-tokens"): string {
    return purpose === "admin-mode"
      ? "/account/api-tokens/verify?purpose=admin-mode"
      : "/account/api-tokens/verify";
  }

  async function openStepUp(purpose: "admin-mode" | "api-tokens") {
    const passkeys = await authClient.passkey.listUserPasskeys();
    if (passkeys.error) {
      await goto(verificationPath(purpose));
      return;
    }
    hasPasskey = (passkeys.data?.length ?? 0) > 0;
    if (!user.twoFactorEnabled && !hasPasskey) {
      await goto(verificationPath(purpose));
      return;
    }
    stepUpPurpose = purpose;
    stepUpOpen = true;
  }

  async function openApiTokens() {
    if (apiTokenBusy) return;
    open = false;
    apiTokenBusy = true;
    try {
      const response = await fetchWithCsrf("/api/api-token-access");
      if (!response.ok) {
        await goto("/account/api-tokens");
        return;
      }
      const result = (await response.json()) as {
        setupRequired: boolean;
        verificationRequired: boolean;
      };
      if (result.setupRequired || !result.verificationRequired) {
        await goto("/account/api-tokens");
        return;
      }
      await openStepUp("api-tokens");
    } finally {
      apiTokenBusy = false;
    }
  }

  async function toggleAdminMode() {
    if (adminBusy) return;
    adminBusy = true;
    const active = !adminAccessActive;
    try {
      const r = await fetchWithCsrf("/api/admin-mode", {
        method: "POST",
        body: JSON.stringify({ active }),
      });
      if (!r.ok) {
        open = false;
        return;
      }
      const result = (await r.json()) as {
        active: boolean;
        verificationRequired?: boolean;
      };
      open = false;
      if (result.verificationRequired) {
        await openStepUp("admin-mode");
        return;
      }
      if (result.active !== active) return;
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

  <DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger
      class="flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-primary text-body-sm font-semibold text-primary-foreground shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover hover:opacity-90"
      disabled={!hydrated}
      title={user.name}
      aria-label={m.userMenu_openAccountMenu({ name: user.name })}
    >
      {#if user.image}
        <img src={user.image} alt={user.name} class="size-full object-cover" />
      {:else}
        {initial}
      {/if}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={8}
        class="z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-modal backdrop-blur-sm"
      >
        {#if hasUsername}
          <DropdownMenu.Item>
            {#snippet child({ props })}
              <a
                {...props}
                class="flex items-center gap-3 border-b border-border-subtle px-4 py-3 outline-none transition-colors duration-fast ease-out-soft hover:bg-accent data-[highlighted]:bg-accent"
                href="/users/{user.id}"
                aria-label={m.userMenu_profile()}
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
            {/snippet}
          </DropdownMenu.Item>
        {:else}
          <div class="border-b border-border-subtle px-4 py-2.5">
            <p class="truncate text-body-sm font-medium">{user.name}</p>
            <p class="truncate text-caption text-muted-foreground">{user.email}</p>
          </div>
        {/if}

        {#if hasUsername}
          <DropdownMenu.Item>
            {#snippet child({ props })}
              <a
                {...props}
                class="flex items-center gap-2 px-4 py-2 text-body-sm outline-none transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                href="/settings"
              >
                <SettingsIcon aria-hidden="true" size={16} />
                {m.navigation_settings()}
              </a>
            {/snippet}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex cursor-pointer items-center gap-2 px-4 py-2 text-body-sm outline-none transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            disabled={apiTokenBusy}
            onSelect={() => void openApiTokens()}
          >
            <KeyRoundIcon aria-hidden="true" size={16} />
            {m.userMenu_apiTokens()}
          </DropdownMenu.Item>
        {/if}

        {#if canSwitchAdminMode}
          <DropdownMenu.Item
            class="flex cursor-pointer items-center gap-2 px-4 py-2 text-body-sm outline-none transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 {adminAccessActive
              ? 'text-primary'
              : ''}"
            disabled={adminBusy}
            onSelect={() => void toggleAdminMode()}
          >
            <ShieldIcon aria-hidden="true" size={16} />
            {adminAccessActive ? m.userMenu_exitAdminMode() : m.userMenu_enterAdminMode()}
          </DropdownMenu.Item>
        {/if}

        <DropdownMenu.Item
          class="flex cursor-pointer items-center gap-2 px-4 py-2 text-body-sm text-destructive outline-none transition-colors duration-fast ease-out-soft hover:bg-destructive/10 data-[highlighted]:bg-destructive/10"
          onSelect={() => void handleSignOut()}
        >
          <LogOutIcon aria-hidden="true" size={16} />
          {m.auth_signOut()}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>

  <StepUpDialog
    bind:open={stepUpOpen}
    purpose={stepUpPurpose}
    hasTotp={user.twoFactorEnabled}
    {hasPasskey}
  />
{/if}
