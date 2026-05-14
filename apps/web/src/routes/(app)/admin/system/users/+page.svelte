<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { Users } from "@lucide/svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import SystemTextToggle, {
    type UiLang
  } from "$lib/components/features/admin/SystemTextToggle.svelte";
  import FilterBar from "$lib/components/features/admin/users/FilterBar.svelte";
  import UsersTable from "$lib/components/features/admin/users/UsersTable.svelte";
  import Pagination from "$lib/components/features/admin/users/Pagination.svelte";
  import { getUsersPageLabels } from "$lib/components/features/admin/users/labels";
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();

  let uiLang = $state<UiLang>("zh");
  const labels = $derived(getUsersPageLabels(uiLang));

  let searchValue = $state(untrack(() => data.search));
  let roleValue = $state(untrack(() => data.roleFilter));

  function applyFilters() {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (roleValue) params.set("role", roleValue);
    goto(`/admin/system/users?${params.toString()}`);
  }
</script>

{#snippet usersActions()}
  <SystemTextToggle bind:value={uiLang} label={labels.systemText} />
{/snippet}

<PageHeader
  eyebrow={m.admin_eyebrow()}
  title={m.admin_usersTitle()}
  description={`${data.totalCount} ${data.totalCount === 1 ? labels.userFound : labels.usersFound} · ${labels.page} ${data.page} ${labels.of} ${data.totalPages}`}
  actions={usersActions}
/>

<div class="space-y-4">
  <FilterBar
    bind:search={searchValue}
    bind:role={roleValue}
    {labels}
    onApply={applyFilters}
  />

  <Card variant="surface" size="lg" class="overflow-hidden p-0">
    {#if data.users.length === 0}
      <EmptyState
        variant="minimal"
        icon={Users}
        title={m.admin_usersEmpty()}
        description={m.admin_usersEmptyHint()}
      />
    {:else}
      <UsersTable users={data.users} actorId={data.actor?.userId} {labels} />
    {/if}
  </Card>

  <Pagination
    page={data.page}
    totalPages={data.totalPages}
    search={data.search}
    roleFilter={data.roleFilter}
    {labels}
  />
</div>
