<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale, setLocale, locales } from "$lib/paraglide/runtime.js";
  import { shortcuts } from "$lib/stores/shortcuts.svelte.js";
  import { cn } from "$lib/utils.js";
  import UserAuthMenu from "../auth/UserMenu.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";

  let currentLocale = $derived(getLocale());
  let user = $derived($page.data.user);
  let currentPath = $derived($page.url.pathname);

  let navItems = $derived(
    user?.username
      ? [
          { href: "/dashboard", label: m.navigation_dashboard() },
          { href: "/problems", label: m.navigation_problems() },
          { href: "/courses", label: m.navigation_courses() },
          { href: "/assignments", label: m.navigation_assignments() },
          { href: "/contests", label: m.navigation_contests() },
          ...(user.platformRole === "admin"
            ? [{ href: "/admin", label: m.navigation_admin() }]
            : [])
        ]
      : []
  );

  function isActive(href: string): boolean {
    if (href === "/dashboard") return currentPath === "/dashboard";
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }

  // Global "g + <key>" navigation shortcuts — only when signed in.
  $effect(() => {
    if (!user) return;

    const unregisters = [
      shortcuts.register({
        id: "nav-dashboard",
        keys: [["G"], ["D"]],
        description: m.shortcuts_goDashboard(),
        category: "navigation",
        handler: () => goto("/dashboard")
      }),
      shortcuts.register({
        id: "nav-problems",
        keys: [["G"], ["P"]],
        description: m.shortcuts_goProblems(),
        category: "navigation",
        handler: () => goto("/problems")
      }),
      shortcuts.register({
        id: "nav-contests",
        keys: [["G"], ["C"]],
        description: m.shortcuts_goContests(),
        category: "navigation",
        handler: () => goto("/contests")
      }),
      shortcuts.register({
        id: "nav-submissions",
        keys: [["G"], ["S"]],
        description: m.shortcuts_goSubmissions(),
        category: "navigation",
        handler: () => goto("/submissions")
      })
    ];

    return () => {
      for (const off of unregisters) off();
    };
  });
</script>

<header
  class="sticky top-6 z-[var(--z-sticky)] rounded-2xl border border-border bg-[color:var(--color-panel)]/85 px-5 py-3 shadow-rest backdrop-blur-md animate-[fade-up_700ms_var(--ease-out-soft)_both] sm:px-6"
>
  <div class="flex flex-wrap items-center gap-6">
    <a
      class="font-display text-title-sm font-bold tracking-tight transition-colors duration-fast ease-out-soft hover:text-primary"
      href="/"
    >
      NOJV
    </a>

    {#if navItems.length > 0}
      <nav class="flex flex-wrap items-center gap-4 text-body-sm font-medium">
        {#each navItems as item (item.href)}
          <a
            class={cn(
              "rounded-md px-3 py-1.5 transition-colors duration-fast ease-out-soft",
              isActive(item.href)
                ? "text-foreground bg-accent/60"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
            href={item.href}
          >
            {item.label}
          </a>
        {/each}
      </nav>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <div
        class="hidden items-center gap-1 rounded-full border border-border-subtle bg-[color:var(--color-panel-strong)] p-1 text-caption sm:flex"
      >
        {#each locales as entry (entry)}
          <button
            class={cn(
              "rounded-full px-2.5 py-1 transition-colors duration-fast ease-out-soft",
              entry === currentLocale
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onclick={() => setLocale(entry)}
            type="button"
          >
            {entry}
          </button>
        {/each}
      </div>
      <ThemeToggle />
      <UserAuthMenu />
    </div>
  </div>
</header>
