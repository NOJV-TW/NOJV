<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { Users } from "@lucide/svelte";
  import { Card } from "$lib/components/ui/card";
  import Section from "$lib/components/ui/Section.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import SystemTextToggle, {
    type UiLang
  } from "$lib/components/manage/SystemTextToggle.svelte";
  import FilterBar from "$lib/components/admin/users/FilterBar.svelte";
  import UsersTable from "$lib/components/admin/users/UsersTable.svelte";
  import Pagination from "$lib/components/admin/users/Pagination.svelte";
  import { getUsersPageLabels } from "$lib/components/admin/users/labels";
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
    goto(`/admin/users?${params.toString()}`);
  }
</script>

<Section class="space-y-4">
  {#snippet header()}
    <h2 class="inline-flex items-center gap-2">
      <Users class="h-5 w-5 text-muted-foreground" />
      {m.admin_usersTitle()}
    </h2>
    <p>
      {data.totalCount}
      {data.totalCount === 1 ? labels.userFound : labels.usersFound} &middot;
      {labels.page} {data.page} {labels.of} {data.totalPages}
    </p>
  {/snippet}
  {#snippet actions()}
    <SystemTextToggle bind:value={uiLang} label={labels.systemText} />
  {/snippet}

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
</Section>
