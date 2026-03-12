<script lang="ts">
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale, setLocale, locales } from "$lib/paraglide/runtime.js";
  import UserAuthMenu from "../auth/UserMenu.svelte";

  let currentLocale = $derived(getLocale());
  let user = $derived($page.data.user as { name: string; handle?: string } | null);

  let navItems = $derived(
    user
      ? [
          { href: "/problems", label: m.navigation_problems() },
          { href: "/courses", label: m.navigation_courses() },
          { href: "/assignments", label: m.navigation_assignments() },
          { href: "/exams", label: m.navigation_exams() }
        ]
      : []
  );
</script>

<header
  class="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-3 backdrop-blur-sm sm:px-6"
>
  <div class="flex flex-wrap items-center gap-4">
    <a
      class="font-[family-name:var(--font-display)] text-xl font-bold"
      href="/"
    >
      NOJV
    </a>

    {#if navItems.length > 0}
      <nav class="flex flex-wrap items-center gap-2 text-sm font-medium">
        {#each navItems as item (item.href)}
          <a
            class="rounded-full border border-[color:var(--color-border)] px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white/70"
            href={item.href}
          >
            {item.label}
          </a>
        {/each}
      </nav>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <div
        class="flex items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-white/60 p-1 text-sm"
      >
        {#each locales as entry (entry)}
          <button
            class="rounded-full px-3 py-1.5 {entry === currentLocale
              ? 'bg-[color:var(--color-accent)] text-white'
              : ''}"
            onclick={() => setLocale(entry)}
            type="button"
          >
            {entry}
          </button>
        {/each}
      </div>
      <UserAuthMenu />
    </div>
  </div>
</header>
