<script lang="ts">
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    page: number;
    totalPages: number;
    usernameFilter: string;
    emailFilter: string;
    nameFilter: string;
    roleFilter: string;
    statusFilter: string;
    createdAtOrder: "asc" | "desc";
  }

  let {
    page,
    totalPages,
    usernameFilter,
    emailFilter,
    nameFilter,
    roleFilter,
    statusFilter,
    createdAtOrder,
  }: Props = $props();

  function hrefFor(target: number): string {
    const params = new URLSearchParams();
    params.set("page", String(target));
    if (usernameFilter) params.set("username", usernameFilter);
    if (emailFilter) params.set("email", emailFilter);
    if (nameFilter) params.set("name", nameFilter);
    if (roleFilter) params.set("role", roleFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (createdAtOrder === "asc") params.set("created", "asc");
    return `/admin/users?${params.toString()}`;
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
