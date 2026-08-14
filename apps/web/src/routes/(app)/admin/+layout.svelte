<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { children } = $props();

  const tabs = [
    { href: "/admin", label: () => m.admin_tabOverview() },
    { href: "/admin/courses", label: () => m.navigation_courses() },
    { href: "/admin/assignments", label: () => m.navigation_assignments() },
    { href: "/admin/exams", label: () => m.navigation_exams() },
    { href: "/admin/contests", label: () => m.navigation_contests() },
    { href: "/admin/users", label: () => m.admin_tabUsers() },
    { href: "/admin/submissions", label: () => m.admin_tabSubmissions() },
    { href: "/admin/announcements", label: () => m.admin_tabAnnouncements() },
    { href: "/admin/reports", label: () => m.admin_tabReports() },
    { href: "/admin/registry", label: () => m.admin_tabRegistry() },
    { href: "/admin/audit", label: () => m.admin_tabAudit() },
  ];

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
        {tab.label()}
      </a>
    {/each}
  </nav>

  {@render children()}
</PageContainer>
