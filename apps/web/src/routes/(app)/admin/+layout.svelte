<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { children } = $props();

  const tabs = [
    { href: "/admin", key: "overview" as const },
    { href: "/admin/users", key: "users" as const },
    { href: "/admin/submissions", key: "submissions" as const },
    { href: "/admin/announcements", key: "announcements" as const },
    { href: "/admin/reports", key: "reports" as const },
    { href: "/admin/registry", key: "registry" as const },
    { href: "/admin/audit", key: "audit" as const },
  ];

  function tabLabel(
    key:
      "overview" | "users" | "submissions" | "announcements" | "reports" | "registry" | "audit",
  ): string {
    if (key === "overview") return m.admin_tabOverview();
    if (key === "users") return m.admin_tabUsers();
    if (key === "submissions") return m.admin_tabSubmissions();
    if (key === "reports") return m.admin_tabReports();
    if (key === "registry") return m.admin_tabRegistry();
    if (key === "audit") return m.admin_tabAudit();
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
