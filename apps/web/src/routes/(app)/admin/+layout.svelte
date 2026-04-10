<script lang="ts">
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/ui/Section.svelte";

  let { children } = $props();

  const tabs = [
    { href: "/admin", key: "overview" as const },
    { href: "/admin/users", key: "users" as const },
    { href: "/admin/announcements", key: "announcements" as const }
  ];

  function tabLabel(key: "overview" | "users" | "announcements"): string {
    if (key === "overview") return m.admin_tabOverview();
    if (key === "users") return m.admin_tabUsers();
    return m.admin_tabAnnouncements();
  }

  let currentPath = $derived($page.url.pathname);
</script>

<div class="space-y-6">
  <Section>
    {#snippet header()}
      <h1>{m.admin_panelTitle()}</h1>
      <p>{m.admin_panelSubtitle()}</p>
    {/snippet}
  </Section>

  <nav
    class="flex flex-wrap gap-1 rounded-full border border-border-subtle bg-[color:var(--color-sidebar)] p-1"
    aria-label={m.admin_panelTitle()}
  >
    {#each tabs as tab (tab.href)}
      {@const isOverview = tab.href === "/admin"}
      {@const isActive = isOverview
        ? currentPath === "/admin"
        : currentPath.startsWith(tab.href)}
      <a
        class="inline-flex min-h-11 items-center rounded-full px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft {isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
        aria-current={isActive ? "page" : undefined}
        href={tab.href}
      >
        {tabLabel(tab.key)}
      </a>
    {/each}
  </nav>

  {@render children()}
</div>
