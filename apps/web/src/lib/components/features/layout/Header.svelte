<script lang="ts">
  import { page } from "$app/state";
  import {
    ClipboardList,
    Code2,
    FileCheck,
    GraduationCap,
    History,
    LayoutDashboard,
    Menu,
    Shield,
    Trophy,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale, setLocale, locales } from "$lib/paraglide/runtime.js";
  import { cn } from "$lib/utils/css.js";
  import UserAuthMenu from "../auth/UserMenu.svelte";
  import NotificationBell from "../notification/NotificationBell.svelte";
  import MobileNavDrawer from "./MobileNavDrawer.svelte";
  import BrandLogo from "$lib/components/primitives/layout/BrandLogo.svelte";
  import ThemeToggle from "$lib/components/primitives/layout/ThemeToggle.svelte";

  let { immersive = false }: { immersive?: boolean } = $props();

  const localeLabels: Record<string, string> = { en: "English", "zh-TW": "中文" };

  let currentLocale = $derived(getLocale());
  let user = $derived(page.data.user);
  let actingAsAdmin = $derived(page.data.actingAsAdmin ?? false);
  let effectiveRole = $derived(
    user?.platformRole === "admin" && !actingAsAdmin ? "student" : user?.platformRole,
  );
  let currentPath = $derived(page.url.pathname);

  type NavItem = { href: string; label: string; icon: Component };

  let navItems = $derived<NavItem[]>(
    user?.username
      ? [
          { href: "/dashboard", label: m.navigation_dashboard(), icon: LayoutDashboard },
          { href: "/problems", label: m.navigation_problems(), icon: Code2 },
          { href: "/submissions", label: m.navigation_submissions(), icon: History },
          { href: "/courses", label: m.navigation_courses(), icon: GraduationCap },
          ...(effectiveRole === "student"
            ? [
                {
                  href: "/assignments",
                  label: m.navigation_assignments(),
                  icon: ClipboardList,
                },
                { href: "/exams", label: m.navigation_exams(), icon: FileCheck },
              ]
            : []),
          { href: "/contests", label: m.navigation_contests(), icon: Trophy },
          ...(actingAsAdmin
            ? [{ href: "/admin", label: m.navigation_admin(), icon: Shield }]
            : []),
        ]
      : [],
  );

  function isActive(href: string): boolean {
    if (href === "/dashboard") return currentPath === "/dashboard";
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }

  let navLinks = $derived(navItems.map((item) => ({ ...item, active: isActive(item.href) })));

  let mobileNavOpen = $state(false);

  $effect(() => {
    void currentPath;
    mobileNavOpen = false;
  });
</script>

<!--
  Full-bleed Carbon top bar. The bar is always dark in both themes, so we
  re-scope the base color tokens on the <header> element to dark-surface
  values; every token-driven child (logo, theme toggle, bell, user menu,
  language pills) then renders correctly on the dark bar without per-child
  overrides. The active-state tokens (--nav-active-*) stay mode-aware.
-->
<header
  class={cn(
    "app-nav z-[var(--z-sticky)] w-full border-b",
    immersive ? "relative" : "sticky top-0 animate-[fade-up_500ms_var(--ease-out-soft)_both]",
  )}
  style="
    background: var(--nav-bg);
    border-color: var(--nav-rule);
    color: #eaeef4;
    --foreground: #eaeef4;
    --muted-foreground: var(--nav-idle);
    --accent: rgba(255, 255, 255, 0.08);
    --accent-foreground: #ffffff;
    --card: rgba(255, 255, 255, 0.06);
    --card-foreground: #eaeef4;
    --secondary: rgba(255, 255, 255, 0.08);
    --secondary-foreground: #eaeef4;
    --muted: rgba(255, 255, 255, 0.06);
    --popover: #232b35;
    --popover-foreground: #eaeef4;
    --border-subtle: var(--nav-rule);
    --border: rgba(255, 255, 255, 0.14);
    --border-strong: rgba(255, 255, 255, 0.24);
    --panel: rgba(255, 255, 255, 0.06);
    --panel-strong: rgba(255, 255, 255, 0.06);
    --color-panel: rgba(255, 255, 255, 0.06);
    --color-panel-strong: rgba(255, 255, 255, 0.06);
    --primary: var(--nav-logo);
    --primary-foreground: #ffffff;
    --ring: var(--nav-logo);
  "
>
  <div class="flex h-[76px] items-center gap-3 px-5 sm:px-6 lg:px-8">
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
      class="mr-1 flex items-center transition-colors duration-fast ease-out-soft hover:text-primary"
      href="/"
    >
      <BrandLogo />
    </a>

    {#if navItems.length > 0}
      <nav class="hidden items-stretch gap-1 lg:flex" aria-label="Primary">
        {#each navLinks as item (item.href)}
          {@const Icon = item.icon}
          <a
            class={cn(
              "flex min-w-[72px] flex-col items-center justify-center gap-1 rounded-xl px-3.5 py-2 transition-colors duration-fast ease-out-soft",
              item.active
                ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-fg)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
          >
            <Icon class="size-[22px]" strokeWidth={1.85} aria-hidden="true" />
            <span class="text-caption font-medium">{item.label}</span>
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
                : "text-muted-foreground hover:text-foreground",
            )}
            onclick={() => setLocale(entry)}
            type="button"
            aria-pressed={entry === currentLocale}
          >
            {localeLabels[entry] ?? entry}
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
