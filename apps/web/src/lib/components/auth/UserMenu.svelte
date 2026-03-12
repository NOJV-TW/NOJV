<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth-client";
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
    await goto("/");
  }
</script>

{#if !session}
  <!-- No session: render nothing (sign-in is handled elsewhere) -->
{:else if !user}
  <div
    class="size-9 animate-pulse rounded-full border border-border bg-white/60"
  ></div>
{:else}
  {@const initial = (user.name.charAt(0) || "?").toUpperCase()}
  {@const hasHandle = !!user.handle}

  <div class="relative">
    <button
      bind:this={btnEl}
      class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-primary text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90"
      onclick={() => (open = !open)}
      title={user.name}
      type="button"
    >
      {initial}
    </button>

    {#if open}
      <div
        bind:this={dropdownEl}
        class="absolute right-0 top-full z-50 mt-2 min-w-[10rem] overflow-hidden rounded-[1.5rem] border border-border bg-[color:var(--color-panel)] py-1 shadow-lg backdrop-blur-sm"
      >
        <div class="border-b border-border px-4 py-2.5">
          <p class="truncate text-sm font-medium">{user.name}</p>
          <p class="truncate text-xs text-muted-foreground">
            {user.email}
          </p>
        </div>

        {#if hasHandle}
          <a
            class="flex items-center gap-2 px-4 py-2 text-sm transition hover:bg-primary/10"
            href="/account"
            onclick={() => (open = false)}
          >
            <UserIcon size={16} />
            {m.navigation_account()}
          </a>
        {/if}

        <button
          class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
          onclick={handleSignOut}
          type="button"
        >
          <LogOutIcon size={16} />
          {m.auth_signOut()}
        </button>
      </div>
    {/if}
  </div>
{/if}
