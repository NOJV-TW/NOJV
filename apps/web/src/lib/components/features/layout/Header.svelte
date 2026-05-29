<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import {
    ClipboardList,
    Code2,
    FileCheck,
    GraduationCap,
    History,
    LayoutDashboard,
    Menu,
    Shield,
    Trophy
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale, setLocale, locales } from "$lib/paraglide/runtime.js";
  import { shortcuts } from "$lib/stores/shortcuts.svelte.js";
  import { cn } from "$lib/utils/css.js";
  import UserAuthMenu from "../auth/UserMenu.svelte";
  import NotificationBell from "../notification/NotificationBell.svelte";
  import MobileNavDrawer from "./MobileNavDrawer.svelte";
  import ThemeToggle from "$lib/components/primitives/layout/ThemeToggle.svelte";

  let currentLocale = $derived(getLocale());
  let user = $derived(page.data.user);
  let currentPath = $derived(page.url.pathname);

  type NavItem = { href: string; label: string; icon: Component };

  let navItems = $derived<NavItem[]>(
    user?.username
      ? [
          { href: "/dashboard", label: m.navigation_dashboard(), icon: LayoutDashboard },
          { href: "/problems", label: m.navigation_problems(), icon: Code2 },
          { href: "/submissions", label: m.navigation_submissions(), icon: History },
          { href: "/courses", label: m.navigation_courses(), icon: GraduationCap },
          ...(user.platformRole === "student"
            ? [
                { href: "/assignments", label: m.navigation_assignments(), icon: ClipboardList },
                { href: "/exams", label: m.navigation_exams(), icon: FileCheck }
              ]
            : []),
          { href: "/contests", label: m.navigation_contests(), icon: Trophy },
          ...(user.platformRole === "admin"
            ? [{ href: "/admin", label: m.navigation_admin(), icon: Shield }]
            : [])
        ]
      : []
  );

  function isActive(href: string): boolean {
    if (href === "/dashboard") return currentPath === "/dashboard";
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }

  let navLinks = $derived(navItems.map((item) => ({ ...item, active: isActive(item.href) })));

  let mobileNavOpen = $state(false);

  // Close the drawer whenever navigation lands on a new path.
  $effect(() => {
    void currentPath;
    mobileNavOpen = false;
  });

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
        id: "nav-exams",
        keys: [["G"], ["E"]],
        description: m.shortcuts_goExams(),
        category: "navigation",
        handler: () => goto("/exams")
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
  class="sticky top-6 z-[var(--z-sticky)] rounded-xl border border-border bg-[color:var(--color-panel)]/85 px-5 py-3 shadow-rest backdrop-blur-md animate-[fade-up_700ms_var(--ease-out-soft)_both] sm:px-6"
>
  <div class="flex flex-wrap items-center gap-6">
    {#if navItems.length > 0}
      <button
        type="button"
        class="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground lg:hidden"
        aria-label={m.nav_openMenu()}
        aria-expanded={mobileNavOpen}
        onclick={() => (mobileNavOpen = true)}
      >
        <Menu class="size-5" aria-hidden="true" />
      </button>
    {/if}

    <a
      class="text-title-sm font-bold tracking-tight transition-colors duration-fast ease-out-soft hover:text-primary"
      href="/"
    >
      NOJV
    </a>

    {#if navItems.length > 0}
      <nav class="hidden flex-wrap items-center gap-2 text-body-sm font-medium lg:flex">
        {#each navLinks as item (item.href)}
          {@const Icon = item.icon}
          <a
            class={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors duration-fast ease-out-soft",
              item.active
                ? "text-foreground bg-accent/60"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            )}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            <Icon class="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <div
        class="flex items-center gap-1 rounded-full border border-border-subtle bg-[color:var(--color-panel-strong)] p-1 text-caption"
        role="group"
        aria-label={m.common_language()}
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
            aria-pressed={entry === currentLocale}
          >
            {entry}
          </button>
        {/each}
      </div>
      <ThemeToggle />
      {#if user}
        <NotificationBell />
      {/if}
      <UserAuthMenu />
    </div>
  </div>
</header>

{#if navItems.length > 0}
  <MobileNavDrawer
    open={mobileNavOpen}
    items={navLinks}
    onclose={() => (mobileNavOpen = false)}
  />
{/if}
