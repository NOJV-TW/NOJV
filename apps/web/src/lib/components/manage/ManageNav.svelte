<script lang="ts">
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";

  interface Props {
    slug: string;
    role: string;
  }

  let { slug, role }: Props = $props();

  const navItems = $derived([
    { href: `/courses/${slug}/manage`, label: m.navigation_dashboard() },
    { href: `/courses/${slug}/manage/members`, label: m.courseManage_members() },
    { href: `/courses/${slug}/manage/assessments`, label: m.courseManage_assessments() },
    { href: `/courses/${slug}/manage/progress`, label: m.courseManage_progress() }
  ]);

  function isActive(itemHref: string, pathname: string): boolean {
    if (itemHref === `/courses/${slug}/manage`) {
      return pathname === itemHref;
    }
    return pathname.startsWith(itemHref);
  }
</script>

<nav
  class="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-3 shadow-rest backdrop-blur-sm"
>
  <div class="flex items-center gap-1">
    {#each navItems as item (item.href)}
      {@const active = isActive(item.href, $page.url.pathname)}
      <a
        href={item.href}
        class="rounded-full px-4 py-2 text-body-sm font-medium transition-[transform,background-color,box-shadow] duration-fast ease-out-soft {active
          ? 'bg-primary text-primary-foreground shadow-rest'
          : 'border border-border-subtle hover:-translate-y-0.5 hover:bg-[color:var(--color-panel-strong)] hover:shadow-hover'}"
      >
        {item.label}
      </a>
    {/each}

    <Badge variant="muted" size="md" class="ml-auto uppercase tracking-[0.2em]">
      {role}
    </Badge>
  </div>
</nav>
