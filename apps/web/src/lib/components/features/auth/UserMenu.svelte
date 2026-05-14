<script lang="ts">
  import { page } from "$app/stores";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import UserIcon from "@lucide/svelte/icons/user";
  import LogOutIcon from "@lucide/svelte/icons/log-out";

  let user = $derived($page.data.user);
  let session = $derived($page.data.session);

  let open = $state(false);
  let btnEl: HTMLButtonElement | undefined = $state();
  let dropdownEl: HTMLDivElement | undefined = $state();

  function handleClickOutside(e: MouseEvent) {
    if (
      btnEl?.contains(e.target as Node) ||
      dropdownEl?.contains(e.target as Node)
    ) {
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

  async function handleSignOut() {
    await authClient.signOut();
    open = false;
    await invalidateAll();
    await goto("/");
  }
</script>

{#if !session || !user}
  <!-- No session or no user: render nothing -->
{:else}
  {@const initial = (user.name.charAt(0) || "?").toUpperCase()}
  {@const hasUsername = !!user.username}

  <div class="relative">
    <button
      bind:this={btnEl}
      class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-primary text-body-sm font-semibold text-primary-foreground shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover hover:opacity-90"
      onclick={() => (open = !open)}
      title={user.name}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
    >
      {initial}
    </button>

    {#if open}
      <div
        bind:this={dropdownEl}
        class="absolute right-0 top-full z-50 mt-2 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-modal backdrop-blur-sm"
        role="menu"
      >
        <div class="border-b border-border-subtle px-4 py-2.5">
          <p class="truncate text-body-sm font-medium">{user.name}</p>
          <p class="truncate text-caption text-muted-foreground">
            {user.email}
          </p>
        </div>

        {#if hasUsername}
          <a
            class="flex items-center gap-2 px-4 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
            href="/account"
            onclick={() => (open = false)}
            role="menuitem"
          >
            <UserIcon size={16} />
            {m.navigation_account()}
          </a>
        {/if}

        <button
          class="flex w-full items-center gap-2 px-4 py-2 text-left text-body-sm text-destructive transition-colors duration-fast ease-out-soft hover:bg-destructive/10"
          onclick={handleSignOut}
          type="button"
          role="menuitem"
        >
          <LogOutIcon size={16} />
          {m.auth_signOut()}
        </button>
      </div>
    {/if}
  </div>
{/if}
