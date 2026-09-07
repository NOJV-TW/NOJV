<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { X } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import BulkHandleAddPanel from "$lib/components/features/course/BulkHandleAddPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { formatDate } from "$lib/utils/datetime";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { members, bulkAddForm } = $derived(data);
  const isManager = $derived(data.isManager);

  let roleFilter = $state("");
  let search = $state("");

  const filtered = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (roleFilter && member.role !== roleFilter) return false;
      if (!needle) return true;
      const name = member.name?.toLowerCase() ?? "";
      const handle = member.username?.toLowerCase() ?? "";
      return name.includes(needle) || handle.includes(needle);
    });
  });

  function initialFor(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed.charAt(0) : "?";
  }

  let pendingRemove = $state<{ userId: string; name: string } | null>(null);

  async function confirmRemove() {
    const target = pendingRemove;
    pendingRemove = null;
    if (!target) return;
    try {
      const body = new FormData();
      body.set("userId", target.userId);
      const res = await fetch("?/remove", { method: "POST", body });
      if (!res.ok) {
        toasts.error(m.members_removeError());
        return;
      }
      await invalidateAll();
    } catch {
      toasts.error(m.members_removeError());
    }
  }

  async function handleRoleChange(event: Event, userId: string, previousRole: string) {
    const select = event.currentTarget as HTMLSelectElement;
    const role = select.value;
    try {
      const body = new FormData();
      body.set("userId", userId);
      body.set("role", role);
      const res = await fetch("?/changeRole", { method: "POST", body });
      if (!res.ok) {
        select.value = previousRole;
        toasts.error(m.members_roleChangeError());
        return;
      }
      await invalidateAll();
      toasts.success(m.members_roleChangeSuccess());
    } catch {
      select.value = previousRole;
      toasts.error(m.members_roleChangeError());
    }
  }

  function formatJoined(iso: string): string {
    const date = formatDate(iso, { month: "short", day: "numeric", year: undefined });
    return m.members_joinedOn({ date });
  }
</script>

<PageContainer class="space-y-8">
  {#if isManager}
    <BulkHandleAddPanel form={bulkAddForm} />
  {/if}

  <div class="animate-in animate-in-3 overflow-x-auto">
    <table class="w-full text-body-sm" aria-label={m.members_title()}>
      <thead class="font-mono text-micro uppercase tracking-wider text-muted-foreground">
        <tr>
          <th scope="col" class="px-4 py-3 text-left align-middle font-medium">
            <TableTextColumnFilter
              label={m.members_title()}
              filterLabel={m.members_searchPlaceholder()}
              inputId="course-member-search"
              applyLabel={m.common_applyFilter()}
              bind:value={search}
            />
          </th>
          {#if isManager}
            <th scope="col" class="px-4 py-3 text-left align-middle font-medium">
              {m.account_email()}
            </th>
          {/if}
          <th scope="col" class="px-4 py-3 text-left align-middle font-medium">
            {m.members_joinedLabel()}
          </th>
          <th scope="col" class="px-4 py-3 text-left align-middle font-medium">
            <TableSelectColumnFilter
              label={m.members_roleLabel()}
              filterLabel={m.members_roleLabel()}
              allLabel={m.members_tabAll()}
              options={[
                { value: "teacher", label: m.members_tabTeachers() },
                { value: "ta", label: m.members_tabTas() },
                { value: "student", label: m.members_tabStudents() },
              ]}
              bind:value={roleFilter}
            />
          </th>
          {#if isManager}
            <th scope="col" class="px-4 py-3 text-right align-middle font-medium">
              <span class="sr-only">{m.admin_usersActions()}</span>
            </th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#if filtered.length === 0}
          <tr class="border-t border-border-subtle">
            <td
              class="px-6 py-14 text-center text-muted-foreground"
              colspan={isManager ? 5 : 3}
            >
              {m.members_empty()}
            </td>
          </tr>
        {:else}
          {#each filtered as member (member.userId)}
            <tr class="border-t border-border-subtle transition-colors hover:bg-muted/25">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div
                    class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-body font-semibold text-primary-foreground {member.isPlaceholder
                      ? 'opacity-50'
                      : ''}"
                    aria-hidden="true"
                  >
                    {#if member.image}
                      <img
                        src={member.image}
                        alt={member.name}
                        class="size-full object-cover"
                      />
                    {:else}
                      {member.isPlaceholder ? "?" : initialFor(member.name)}
                    {/if}
                  </div>
                  <div class="whitespace-nowrap">
                    <div class={member.isPlaceholder ? "text-muted-foreground" : "font-medium"}>
                      {member.isPlaceholder ? m.members_placeholderNotLoggedIn() : member.name}
                    </div>
                    <div class="mt-0.5 font-mono text-caption text-muted-foreground">
                      {member.username ?? "—"}
                    </div>
                  </div>
                </div>
              </td>
              {#if isManager}
                <td
                  class="whitespace-nowrap px-4 py-3 text-left font-mono text-caption text-muted-foreground"
                >
                  {member.email ?? "—"}
                </td>
              {/if}
              <td
                class="whitespace-nowrap px-4 py-3 text-caption text-muted-foreground tabular-nums"
              >
                {#if member.isPlaceholder}
                  {m.members_placeholderJoined()}
                {:else}
                  {formatJoined(member.joinedAt)}
                {/if}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-caption">
                {#if member.role === "teacher"}
                  <span class="font-medium text-primary">{m.members_roleTeacher()}</span>
                {:else if isManager}
                  <select
                    class="rounded-none border-0 border-b border-border bg-transparent py-1.5 pl-1 pr-2 text-caption focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    aria-label={m.members_roleFor({ name: member.name })}
                    value={member.role}
                    onchange={(e) => handleRoleChange(e, member.userId, member.role)}
                  >
                    <option value="student">{m.members_roleStudent()}</option>
                    <option value="ta">{m.members_roleTa()}</option>
                  </select>
                {:else}
                  <span class="text-muted-foreground">
                    {member.role === "ta" ? m.members_roleTa() : m.members_roleStudent()}
                  </span>
                {/if}
              </td>
              {#if isManager}
                <td class="px-4 py-3 text-right">
                  {#if member.role !== "teacher"}
                    <button
                      type="button"
                      class="rounded-sm bg-transparent p-1.5 text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-transparent hover:text-destructive"
                      aria-label={m.members_removeAction()}
                      title={m.members_removeAction()}
                      onclick={() =>
                        (pendingRemove = { userId: member.userId, name: member.name })}
                    >
                      <X aria-hidden="true" class="size-4" />
                    </button>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <ConfirmDialog
    open={pendingRemove !== null}
    title={m.members_removeAction()}
    message={pendingRemove ? m.members_removeConfirm({ name: pendingRemove.name }) : ""}
    confirmText={m.members_removeAction()}
    variant="danger"
    onconfirm={confirmRemove}
    oncancel={() => (pendingRemove = null)}
  />
</PageContainer>
