<script lang="ts">
  import { untrack } from "svelte";
  import type { PlatformRole } from "@nojv/core";
  import { goto } from "$app/navigation";
  import { Users } from "@lucide/svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import UsersTable from "$lib/components/features/admin/users/UsersTable.svelte";
  import Pagination from "$lib/components/features/admin/users/Pagination.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { data } = $props();

  let usernameValue = $state(untrack(() => data.usernameFilter));
  let emailValue = $state(untrack(() => data.emailFilter));
  let nameValue = $state(untrack(() => data.nameFilter));
  let roleValue = $state<PlatformRole | "">(
    untrack(() => data.roleFilter as PlatformRole | ""),
  );
  let statusValue = $state<"active" | "disabled" | "">(
    untrack(() => data.statusFilter as "active" | "disabled" | ""),
  );
  let createdAtOrderValue = $state<"asc" | "desc">(
    untrack(() => data.createdAtOrder as "asc" | "desc"),
  );

  $effect(() => {
    usernameValue = data.usernameFilter;
    emailValue = data.emailFilter;
    nameValue = data.nameFilter;
    roleValue = data.roleFilter as PlatformRole | "";
    statusValue = data.statusFilter as "active" | "disabled" | "";
    createdAtOrderValue = data.createdAtOrder as "asc" | "desc";
  });

  function applyFilters() {
    const params = new URLSearchParams();
    if (usernameValue) params.set("username", usernameValue);
    if (emailValue) params.set("email", emailValue);
    if (nameValue) params.set("name", nameValue);
    if (roleValue) params.set("role", roleValue);
    if (statusValue) params.set("status", statusValue);
    if (createdAtOrderValue === "asc") params.set("created", "asc");
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

  <Card variant="surface" size="lg" class="overflow-hidden p-0">
    {#if data.users.length === 0 && !data.usernameFilter && !data.emailFilter && !data.nameFilter && !data.roleFilter && !data.statusFilter}
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
        bind:usernameFilter={usernameValue}
        bind:emailFilter={emailValue}
        bind:nameFilter={nameValue}
        bind:roleFilter={roleValue}
        bind:statusFilter={statusValue}
        bind:createdAtOrder={createdAtOrderValue}
        onApply={applyFilters}
      />
    {/if}
  </Card>

  <Pagination
    page={data.page}
    totalPages={data.totalPages}
    usernameFilter={data.usernameFilter}
    emailFilter={data.emailFilter}
    nameFilter={data.nameFilter}
    roleFilter={data.roleFilter}
    statusFilter={data.statusFilter}
    createdAtOrder={data.createdAtOrder}
  />
</PageContainer>
