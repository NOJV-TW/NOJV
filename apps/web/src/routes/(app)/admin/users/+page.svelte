<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { Users } from "@lucide/svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import FilterBar from "$lib/components/features/admin/users/FilterBar.svelte";
  import UsersTable from "$lib/components/features/admin/users/UsersTable.svelte";
  import Pagination from "$lib/components/features/admin/users/Pagination.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();

  let searchValue = $state(untrack(() => data.search));
  let roleValue = $state(untrack(() => data.roleFilter));

  function applyFilters() {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (roleValue) params.set("role", roleValue);
    goto(`/admin/users?${params.toString()}`, { keepFocus: true, noScroll: true });
  }
</script>

<PageContainer class="space-y-4">
  <header class="animate-in space-y-1">
    <h1 class="text-title-lg font-semibold">{m.admin_usersTitle()}</h1>
    <p class="text-caption text-muted-foreground">
      {m.admin_usersFound({ count: data.totalCount })} · {m.admin_usersPageOf({
        page: data.page,
        totalPages: data.totalPages,
      })}
    </p>
  </header>

  <FilterBar bind:search={searchValue} bind:role={roleValue} onApply={applyFilters} />

  <Card variant="surface" size="lg" class="overflow-hidden p-0">
    {#if data.users.length === 0}
      <EmptyState
        variant="minimal"
        icon={Users}
        title={m.admin_usersEmpty()}
        description={m.admin_usersEmptyHint()}
      />
    {:else}
      <UsersTable
        users={data.users}
        actorId={data.actor?.userId}
        canManageAdmins={data.canManageAdmins}
      />
    {/if}
  </Card>

  <Pagination
    page={data.page}
    totalPages={data.totalPages}
    search={data.search}
    roleFilter={data.roleFilter}
  />
</PageContainer>
