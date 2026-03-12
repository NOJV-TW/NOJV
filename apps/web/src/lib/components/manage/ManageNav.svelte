<script lang="ts">
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    slug: string;
    role: string;
  }

  let { slug, role }: Props = $props();

  const navItems = $derived([
    { href: `/courses/${slug}/manage`, label: m.navigation_dashboard() },
    { href: `/courses/${slug}/manage/members`, label: m.courseManage_members() },
    { href: `/courses/${slug}/manage/problems`, label: m.navigation_problems() },
    { href: `/courses/${slug}/manage/assessments`, label: m.courseManage_assessments() }
  ]);

  function isActive(itemHref: string, pathname: string): boolean {
    if (itemHref === `/courses/${slug}/manage`) {
      return pathname === itemHref;
    }
    return pathname.startsWith(itemHref);
  }
</script>

<nav
  class="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-3 backdrop-blur-sm"
>
  <div class="flex items-center gap-1">
    {#each navItems as item (item.href)}
      {@const active = isActive(item.href, $page.url.pathname)}
      <a
        href={item.href}
        class="rounded-full px-4 py-2 text-sm font-medium transition {active
          ? 'bg-primary text-white'
          : 'border border-border hover:-translate-y-0.5 hover:bg-[color:var(--color-panel)]'}"
      >
        {item.label}
      </a>
    {/each}

    <span
      class="ml-auto inline-flex items-center rounded-full border border-border bg-[color:var(--color-panel)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
    >
      {role}
    </span>
  </div>
</nav>
