<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { enhance } from "$app/forms";
  import { Pencil, Trash2 } from "@lucide/svelte";
  import { Tooltip } from "bits-ui";
  import { Button } from "$lib/components/primitives/ui/button";
  import * as Select from "$lib/components/primitives/ui/select";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import { submitFormAction } from "$lib/utils/actions";
  import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
  import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
  import TableSortButton from "$lib/components/primitives/ui/TableSortButton.svelte";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import BulkHandleAddPanel from "$lib/components/features/course/BulkHandleAddPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { formatDate } from "$lib/utils/datetime";
  import { avatarSrc } from "$lib/utils/avatar-src";
  import {
    ariaSort,
    sortDirection,
    sortRows,
    toggleSort,
    type TableSort,
  } from "$lib/utils/table-sort";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { members, bulkAddForm } = $derived(data);
  const isManager = $derived(data.isManager);

  let roleFilter = $state("");
  let search = $state("");
  let emailSearch = $state("");
  let sort = $state<TableSort<"joined">>({ key: "joined", direction: "desc" });
  let editingMembershipId = $state<string | null>(null);
  let correctedUsername = $state("");
  let correcting = $state(false);
  let correctionError = $state("");

  const filtered = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    const emailNeedle = emailSearch.trim().toLowerCase();
    const matches = members.filter((member) => {
      if (roleFilter && member.role !== roleFilter) return false;
      if (emailNeedle && !member.email?.toLowerCase().includes(emailNeedle)) return false;
      if (!needle) return true;
      const name = member.name?.toLowerCase() ?? "";
      const handle = member.username?.toLowerCase() ?? "";
      return name.includes(needle) || handle.includes(needle);
    });
    const byHandle = matches.sort((a, b) =>
      (a.username ?? a.membershipId).localeCompare(b.username ?? b.membershipId),
    );
    return sortRows(byHandle, sort.direction, (member) => member.joinedAt);
  });

  function initialFor(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed.charAt(0) : "?";
  }

  let pendingRemove = $state<{ membershipId: string; name: string } | null>(null);

  async function confirmRemove() {
    const target = pendingRemove;
    pendingRemove = null;
    if (!target) return;
    try {
      await submitFormAction("?/remove", { membershipId: target.membershipId });
      await invalidateAll();
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.members_removeError());
    }
  }

  let roleDrafts = $state<Record<string, string | undefined>>({});

  async function handleRoleChange(role: string, membershipId: string, previousRole: string) {
    if (role === previousRole) return;
    roleDrafts[membershipId] = role;
    try {
      await submitFormAction("?/changeRole", { membershipId, role });
      await invalidateAll();
      toasts.success(m.members_roleChangeSuccess());
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : m.members_roleChangeError());
    } finally {
      roleDrafts[membershipId] = undefined;
    }
  }

  function roleLabel(role: string): string {
    if (role === "teacher") return m.members_roleTeacher();
    return role === "ta" ? m.members_roleTa() : m.members_roleStudent();
  }

  function formatJoined(iso: string): string {
    const date = formatDate(iso, { month: "short", day: "numeric", year: undefined });
    return m.members_joinedOn({ date });
  }
</script>

<PageContainer class="space-y-8">
  {#if data.canAddMembers}
    <BulkHandleAddPanel form={bulkAddForm} canAddTa={data.canChangeRoles} />
  {/if}

  <Tooltip.Provider delayDuration={200}>
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
                <TableTextColumnFilter
                  label={m.account_email()}
                  filterLabel={m.account_email()}
                  inputId="course-member-email-search"
                  applyLabel={m.common_applyFilter()}
                  bind:value={emailSearch}
                />
              </th>
            {/if}
            <th
              scope="col"
              class="px-4 py-3 text-left align-middle font-medium"
              aria-sort={ariaSort(sortDirection(sort, "joined"))}
            >
              <TableSortButton
                label={m.members_joinedLabel()}
                direction={sortDirection(sort, "joined")}
                onclick={() => (sort = toggleSort(sort, "joined"))}
              />
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
            {#each filtered as member (member.membershipId)}
              <tr
                data-membership-id={member.membershipId}
                data-is-pending={member.isPending}
                class="border-t border-border-subtle transition-colors hover:bg-muted/25"
              >
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3">
                    <div
                      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-body font-semibold text-primary-foreground {member.isPending
                        ? 'opacity-50'
                        : ''}"
                      aria-hidden="true"
                    >
                      {#if member.image}
                        <img
                          src={avatarSrc(member.image)}
                          alt={member.name}
                          class="size-full rounded-full object-cover"
                        />
                      {:else}
                        {member.isPending ? "?" : initialFor(member.name)}
                      {/if}
                    </div>
                    <div class="whitespace-nowrap">
                      <div class={member.isPending ? "text-muted-foreground" : "font-medium"}>
                        {member.isPending ? m.members_pendingActivation() : member.name}
                      </div>
                      <div class="mt-0.5 font-mono text-caption text-muted-foreground">
                        {#if editingMembershipId === member.membershipId}
                          <form
                            method="POST"
                            action="?/correctUsername"
                            class="space-y-2"
                            use:enhance={() => {
                              correcting = true;
                              correctionError = "";
                              return async ({ result, update }) => {
                                try {
                                  if (result.type === "success") {
                                    await update({ reset: false });
                                    editingMembershipId = null;
                                    toasts.success(m.members_usernameCorrected());
                                  } else {
                                    correctionError =
                                      result.type === "failure" &&
                                      typeof result.data?.error === "string"
                                        ? result.data.error
                                        : m.members_usernameCorrectionError();
                                  }
                                } finally {
                                  correcting = false;
                                }
                              };
                            }}
                          >
                            <input
                              type="hidden"
                              name="membershipId"
                              value={member.membershipId}
                            />
                            <input
                              name="username"
                              aria-label={m.members_correctUsername()}
                              bind:value={correctedUsername}
                              required
                              minlength="3"
                              maxlength="64"
                              disabled={correcting}
                              class="w-full rounded-md border border-input bg-background px-3 py-2 text-body-sm"
                            />
                            <div class="flex gap-2">
                              <Button type="submit" size="sm" disabled={correcting}
                                >{m.common_save()}</Button
                              >
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={correcting}
                                onclick={() => (editingMembershipId = null)}
                                >{m.common_cancel()}</Button
                              >
                            </div>
                            {#if correctionError}<p role="alert" class="text-destructive">
                                {correctionError}
                              </p>{/if}
                          </form>
                        {:else}
                          {member.username ?? "—"}
                          {#if member.canCorrectUsername}
                            <button
                              type="button"
                              aria-label={m.members_correctUsername()}
                              title={m.members_correctUsername()}
                              disabled={correcting}
                              class="ml-2 rounded-sm p-1 hover:text-foreground"
                              onclick={() => {
                                editingMembershipId = member.membershipId;
                                correctedUsername = member.username ?? "";
                                correctionError = "";
                              }}><Pencil class="size-3.5" aria-hidden="true" /></button
                            >
                          {/if}
                        {/if}
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
                  {formatJoined(member.joinedAt)}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-caption">
                  {#if member.canChangeRole}
                    <Select.Root
                      type="single"
                      value={roleDrafts[member.membershipId] ?? member.role}
                      disabled={Boolean(roleDrafts[member.membershipId])}
                      onValueChange={(value) =>
                        void handleRoleChange(value, member.membershipId, member.role)}
                    >
                      <Select.Trigger
                        size="sm"
                        class="rounded-none border-0 border-b border-border bg-transparent px-1 text-caption shadow-none! dark:bg-transparent dark:hover:bg-transparent"
                        aria-label={m.members_roleFor({ name: member.name })}
                      >
                        {roleLabel(roleDrafts[member.membershipId] ?? member.role)}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="student" label={m.members_roleStudent()} />
                        <Select.Item value="ta" label={m.members_roleTa()} />
                        {#if data.canAssignTeacher}
                          <Select.Item value="teacher" label={m.members_roleTeacher()} />
                        {/if}
                      </Select.Content>
                    </Select.Root>
                  {:else if member.role === "teacher"}
                    <span class="font-medium text-primary">{m.members_roleTeacher()}</span>
                  {:else}
                    <span class="text-muted-foreground">
                      {member.role === "ta" ? m.members_roleTa() : m.members_roleStudent()}
                    </span>
                  {/if}
                </td>
                {#if isManager}
                  <td class="px-4 py-3 text-right">
                    {#if member.canRemove}
                      <Tooltip.Root>
                        <Tooltip.Trigger
                          onclick={() =>
                            (pendingRemove = {
                              membershipId: member.membershipId,
                              name: member.name,
                            })}
                        >
                          {#snippet child({ props })}
                            <button
                              {...props}
                              type="button"
                              class="rounded-sm bg-transparent p-1.5 text-destructive transition-colors duration-fast ease-out-soft hover:bg-destructive/10"
                              aria-label={m.members_removeAction()}
                            >
                              <Trash2 aria-hidden="true" class="size-4" />
                            </button>
                          {/snippet}
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content
                            class="z-50 rounded-md border border-border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-hover"
                            sideOffset={4}
                          >
                            {m.members_removeAction()}
                            <Tooltip.Arrow class="fill-popover stroke-border" />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </Tooltip.Provider>

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
