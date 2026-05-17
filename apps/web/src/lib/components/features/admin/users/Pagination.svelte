<script lang="ts">
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    page: number;
    totalPages: number;
    search: string;
    roleFilter: string;
  }

  let { page, totalPages, search, roleFilter }: Props = $props();

  function hrefFor(target: number): string {
    const params = new URLSearchParams();
    params.set("page", String(target));
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    return `/admin/system/users?${params.toString()}`;
  }
</script>

{#if totalPages > 1}
  <div class="flex items-center justify-center gap-2">
    {#if page > 1}
      <Button variant="outline" size="sm" href={hrefFor(page - 1)}>
        {m.admin_usersPrevious()}
      </Button>
    {/if}
    <span class="px-3 py-2 text-body-sm text-muted-foreground tabular-nums">
      {page} / {totalPages}
    </span>
    {#if page < totalPages}
      <Button variant="outline" size="sm" href={hrefFor(page + 1)}>
        {m.admin_usersNext()}
      </Button>
    {/if}
  </div>
{/if}
