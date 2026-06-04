<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { children } = $props();

  const tabs = [
    { href: "/admin", key: "overview" as const },
    { href: "/admin/system/users", key: "users" as const },
    { href: "/admin/content/announcements", key: "announcements" as const },
    { href: "/admin/content/editorial-reports", key: "editorialReports" as const },
    { href: "/admin/rejudges", key: "rejudges" as const }
  ];

  function tabLabel(
    key: "overview" | "users" | "announcements" | "editorialReports" | "rejudges"
  ): string {
    if (key === "overview") return m.admin_tabOverview();
    if (key === "users") return m.admin_tabUsers();
    if (key === "editorialReports") return m.admin_tabEditorialReports();
    if (key === "rejudges") return m.admin_tabRejudges();
    return m.admin_tabAnnouncements();
  }

  let currentPath = $derived(page.url.pathname);
</script>

<PageContainer>
  <nav
    class="animate-in animate-in-1 mb-6 flex flex-wrap gap-1 rounded-full border border-border-subtle bg-[color:var(--color-sidebar)] p-1"
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
</PageContainer>
