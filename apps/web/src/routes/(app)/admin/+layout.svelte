<script lang="ts">
  import { page } from "$app/stores";

  let { children } = $props();

  const tabs = [
    { href: "/admin/users", label: "Users" },
    { href: "/admin/system", label: "System" },
    { href: "/admin/announcements", label: "Announcements" }
  ];

  let currentPath = $derived($page.url.pathname);
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-3xl font-bold">Admin Panel</h1>
  </div>

  <nav class="flex gap-2">
    {#each tabs as tab (tab.href)}
      <a
        class="rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white/70 {currentPath.startsWith(tab.href) ? 'bg-primary text-white hover:bg-primary/90' : ''}"
        href={tab.href}
      >
        {tab.label}
      </a>
    {/each}
  </nav>

  {@render children()}
</div>
