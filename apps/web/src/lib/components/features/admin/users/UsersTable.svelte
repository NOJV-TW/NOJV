<script module lang="ts">
  import type { PlatformRole } from "@nojv/core";

  export interface UsersTableUser {
    id: string;
    username: string | null;
    email: string;
    name: string;
    platformRole: PlatformRole;
    disabled: boolean;
    canCreateAdvancedProblems: boolean;
    createdAt: Date | string;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { enhance } from "$app/forms";
  import {
    ArrowDown,
    ArrowUp,
    Ban,
    CircleCheck,
    ListFilter,
    Trash2,
    UserCog,
    X,
  } from "@lucide/svelte";
  import { Popover } from "bits-ui";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import { formatDate } from "$lib/utils/datetime";

  interface Props {
    users: UsersTableUser[];
    actorId: string | undefined;
    canManageAdmins: boolean;
    usernameFilter: string;
    emailFilter: string;
    nameFilter: string;
    roleFilter: PlatformRole | "";
    statusFilter: "active" | "disabled" | "";
    createdAtOrder: "asc" | "desc";
    onApply: () => void;
  }

  let {
    users,
    actorId,
    canManageAdmins,
    usernameFilter = $bindable(),
    emailFilter = $bindable(),
    nameFilter = $bindable(),
    roleFilter = $bindable(),
    statusFilter = $bindable(),
    createdAtOrder = $bindable(),
    onApply,
  }: Props = $props();

  let selected = $state<Set<string>>(new Set());

  $effect(() => {
    void users;
    untrack(() => {
      if (selected.size > 0) selected = new Set();
    });
  });

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function roleBadgeVariant(role: PlatformRole): "warning" | "info" | "success" {
    if (role === "admin") return "warning";
    if (role === "teacher") return "info";
    return "success";
  }

  function roleLabel(role: PlatformRole): string {
    if (role === "admin") return m.common_roleAdmin();
    if (role === "teacher") return m.common_roleTeacher();
    return m.common_roleStudent();
  }

  const assignableRoles = $derived<PlatformRole[]>(
    canManageAdmins ? ["admin", "teacher", "student"] : ["teacher", "student"],
  );

  function canManage(user: UsersTableUser): boolean {
    if (user.id === actorId) return false;
    if (user.platformRole === "admin" && !canManageAdmins) return false;
    return true;
  }

  function displayName(user: UsersTableUser): string {
    return user.username ?? user.name;
  }

  let roleFilterOpen = $state(false);
  let statusFilterOpen = $state(false);
  let createdAtOrderOpen = $state(false);

  const roleFilterOptions = [
    { value: "", label: m.admin_usersFilterAll },
    { value: "admin", label: m.common_roleAdmin },
    { value: "teacher", label: m.common_roleTeacher },
    { value: "student", label: m.common_roleStudent },
  ] as const;

  const statusFilterOptions = [
    { value: "", label: m.admin_usersFilterAll },
    { value: "active", label: m.admin_usersStatusActive },
    { value: "disabled", label: m.admin_usersStatusDisabled },
  ] as const;

  const createdAtOrderOptions = [
    { value: "desc", label: m.admin_usersNewestFirst },
    { value: "asc", label: m.admin_usersOldestFirst },
  ] as const;

  function applyRoleFilter(value: PlatformRole | "") {
    roleFilter = value;
    roleFilterOpen = false;
    onApply();
  }

  function applyStatusFilter(value: "active" | "disabled" | "") {
    statusFilter = value;
    statusFilterOpen = false;
    onApply();
  }

  function applyCreatedAtOrder(value: "asc" | "desc") {
    createdAtOrder = value;
    createdAtOrderOpen = false;
    onApply();
  }

  let pending = $state<{
    form: HTMLFormElement;
    title: string;
    message: string;
    confirmText: string;
    variant: "default" | "danger";
  } | null>(null);

  function requestConfirm(
    e: MouseEvent,
    cfg: { title: string; message: string; confirmText: string; variant: "default" | "danger" },
  ) {
    e.preventDefault();
    const form = (e.currentTarget as HTMLButtonElement).form;
    if (!form) return;
    pending = { form, ...cfg };
  }

  function maybeConfirmDisable(e: MouseEvent, user: UsersTableUser) {
    if (user.disabled) return;
    requestConfirm(e, {
      title: m.admin_usersDisable(),
      message: m.admin_usersDisableConfirm({ username: displayName(user) }),
      confirmText: m.admin_usersDisable(),
      variant: "default",
    });
  }

  function confirmDelete(e: MouseEvent, user: UsersTableUser) {
    requestConfirm(e, {
      title: m.admin_usersDeleteAccount(),
      message: m.admin_usersDeleteConfirm({ username: displayName(user) }),
      confirmText: m.admin_usersDeleteAccount(),
      variant: "danger",
    });
  }

  function runConfirm() {
    const form = pending?.form;
    pending = null;
    form?.requestSubmit();
  }

  function cancelConfirm() {
    pending?.form.reset();
    pending = null;
  }

  function handleRoleChange(e: Event, user: UsersTableUser) {
    const select = e.currentTarget as HTMLSelectElement;
    const form = select.form;
    const targetRole = select.value as PlatformRole;
    if (!form || targetRole === user.platformRole) return;
    if (user.platformRole === "admin" || targetRole === "admin") {
      pending = {
        form,
        title: m.admin_usersRoleChangeTitle(),
        message: m.admin_usersRoleChangeConfirm({
          username: displayName(user),
          to: roleLabel(targetRole),
        }),
        confirmText: m.common_confirm(),
        variant: "default",
      };
      return;
    }
    form.requestSubmit();
  }

  function roleSubmission(user: UsersTableUser): SubmitFunction {
    return ({ formData, formElement }) => {
      const targetRole = formData.get("role") as PlatformRole;
      const name = displayName(user);
      return async ({ result, update }) => {
        if (result.type === "success") {
          toasts.success(
            m.admin_usersRoleUpdateSuccess({ username: name, to: roleLabel(targetRole) }),
          );
          await update();
        } else if (result.type === "failure") {
          formElement.reset();
          const err =
            (result.data as { error?: string } | undefined)?.error ??
            m.admin_usersRoleUpdateFailed();
          toasts.error(err);
        } else {
          await update();
        }
      };
    };
  }

  function advancedSubmission(user: UsersTableUser): SubmitFunction {
    return ({ formData, formElement }) => {
      const allowed = formData.get("allowed") === "true";
      const name = displayName(user);
      return async ({ result, update }) => {
        if (result.type === "success") {
          toasts.success(
            allowed
              ? m.admin_usersAdvancedGrantSuccess({ username: name })
              : m.admin_usersAdvancedRevokeSuccess({ username: name }),
          );
          await update();
        } else if (result.type === "failure") {
          formElement.reset();
          const err =
            (result.data as { error?: string } | undefined)?.error ??
            m.admin_usersAdvancedUpdateFailed();
          toasts.error(err);
        } else {
          await update();
        }
      };
    };
  }

  const selectableUsers = $derived(users.filter(canManage));
  const allSelected = $derived(
    selectableUsers.length > 0 && selectableUsers.every((u) => selected.has(u.id)),
  );
  const someSelected = $derived(selected.size > 0 && !allSelected);
  const selectedIdsJson = $derived(JSON.stringify([...selected]));

  function toggleAll() {
    selected = allSelected ? new Set() : new Set(selectableUsers.map((u) => u.id));
  }

  function bulkResult(successMessage: (count: number) => string) {
    return async ({
      result,
      update,
    }: {
      result: { type: string; data?: Record<string, unknown> };
      update: () => Promise<void>;
    }) => {
      if (result.type === "success") {
        const affected = Number(result.data?.affected ?? 0);
        toasts.success(successMessage(affected));
        await update();
      } else if (result.type === "failure") {
        const err =
          (result.data as { error?: string } | undefined)?.error ?? m.admin_usersBulkFailed();
        toasts.error(err);
      } else {
        await update();
      }
    };
  }
</script>

{#if selected.size > 0}
  <div
    class="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-muted/40 px-5 py-3"
  >
    <span class="text-body-sm font-medium">
      {m.admin_usersBulkSelected({ count: selected.size })}
    </span>
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <form
        method="POST"
        action="?/bulkSetDisabled"
        use:enhance={() => bulkResult((count) => m.admin_usersBulkDisableSuccess({ count }))}
      >
        <input type="hidden" name="userIds" value={selectedIdsJson} />
        <input type="hidden" name="disabled" value="true" />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          onclick={(e) =>
            requestConfirm(e, {
              title: m.admin_usersBulkDisable(),
              message: m.admin_usersBulkDisableConfirm({ count: selected.size }),
              confirmText: m.admin_usersBulkDisable(),
              variant: "default",
            })}
        >
          <Ban aria-hidden="true" class="h-3.5 w-3.5" />
          {m.admin_usersBulkDisable()}
        </Button>
      </form>
      <form
        method="POST"
        action="?/bulkSetDisabled"
        use:enhance={() => bulkResult((count) => m.admin_usersBulkEnableSuccess({ count }))}
      >
        <input type="hidden" name="userIds" value={selectedIdsJson} />
        <input type="hidden" name="disabled" value="false" />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          onclick={(e) =>
            requestConfirm(e, {
              title: m.admin_usersBulkEnable(),
              message: m.admin_usersBulkEnableConfirm({ count: selected.size }),
              confirmText: m.admin_usersBulkEnable(),
              variant: "default",
            })}
        >
          <CircleCheck aria-hidden="true" class="h-3.5 w-3.5" />
          {m.admin_usersBulkEnable()}
        </Button>
      </form>
      <form
        method="POST"
        action="?/bulkDelete"
        use:enhance={() => bulkResult((count) => m.admin_usersBulkDeleteSuccess({ count }))}
      >
        <input type="hidden" name="userIds" value={selectedIdsJson} />
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          onclick={(e) =>
            requestConfirm(e, {
              title: m.admin_usersBulkDelete(),
              message: m.admin_usersBulkDeleteConfirm({ count: selected.size }),
              confirmText: m.admin_usersBulkDelete(),
              variant: "danger",
            })}
        >
          <Trash2 aria-hidden="true" class="h-3.5 w-3.5" />
          {m.admin_usersBulkDelete()}
        </Button>
      </form>
      <Button variant="ghost" size="sm" onclick={() => (selected = new Set())}>
        <X aria-hidden="true" class="h-3.5 w-3.5" />
        {m.admin_usersBulkClear()}
      </Button>
    </div>
  </div>
{/if}

<div class="overflow-x-auto">
  <table class="w-full text-body-sm">
    <thead>
      <tr class="border-b border-border-subtle text-left whitespace-nowrap">
        <th class="w-10 px-5 py-3">
          <input
            type="checkbox"
            class="size-4 cursor-pointer accent-primary"
            checked={allSelected}
            indeterminate={someSelected}
            disabled={selectableUsers.length === 0}
            aria-label={m.admin_usersSelectAll()}
            onchange={toggleAll}
          />
        </th>
        <th class="px-5 py-3 font-medium">
          <TableTextColumnFilter
            label={m.admin_usersUsername()}
            filterLabel={m.admin_usersFilterUsername()}
            inputId="admin-user-username-filter"
            applyLabel={m.admin_usersSearch()}
            bind:value={usernameFilter}
            {onApply}
          />
        </th>
        <th class="px-5 py-3 font-medium">
          <TableTextColumnFilter
            label={m.admin_usersEmail()}
            filterLabel={m.admin_usersFilterEmail()}
            inputId="admin-user-email-filter"
            applyLabel={m.admin_usersSearch()}
            bind:value={emailFilter}
            {onApply}
          />
        </th>
        <th class="px-5 py-3 font-medium">
          <TableTextColumnFilter
            label={m.admin_usersName()}
            filterLabel={m.admin_usersFilterName()}
            inputId="admin-user-name-filter"
            applyLabel={m.admin_usersSearch()}
            bind:value={nameFilter}
            {onApply}
          />
        </th>
        <th class="px-5 py-3 font-medium">
          <div class="flex items-center gap-1">
            <Popover.Root bind:open={roleFilterOpen}>
              <Popover.Trigger
                type="button"
                class="-ml-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {roleFilter
                  ? 'bg-primary/10 text-primary hover:bg-primary/15'
                  : 'hover:bg-muted hover:text-foreground'}"
                aria-label={m.admin_usersFilterRole()}
                aria-pressed={Boolean(roleFilter)}
              >
                <span>{roleFilter ? roleLabel(roleFilter) : m.admin_usersRole()}</span>
                <ListFilter aria-hidden="true" class="size-3.5 shrink-0" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  sideOffset={6}
                  align="start"
                  role="dialog"
                  aria-label={m.admin_usersFilterRole()}
                  class="z-50 w-48 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                >
                  <p class="px-2 pb-1.5 pt-1 text-caption font-medium text-muted-foreground">
                    {m.admin_usersFilterRole()}
                  </p>
                  {#each roleFilterOptions as option}
                    <button
                      type="button"
                      class="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-body-sm font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={roleFilter === option.value}
                      onclick={() => applyRoleFilter(option.value)}
                    >
                      {option.label()}
                      {#if roleFilter === option.value}
                        <CircleCheck aria-hidden="true" class="size-4 text-primary" />
                      {/if}
                    </button>
                  {/each}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </th>
        <th class="px-5 py-3 font-medium">{m.admin_usersAdvancedColumn()}</th>
        <th class="px-5 py-3 font-medium">
          <div class="flex items-center gap-1">
            <Popover.Root bind:open={statusFilterOpen}>
              <Popover.Trigger
                type="button"
                class="-ml-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {statusFilter
                  ? 'bg-primary/10 text-primary hover:bg-primary/15'
                  : 'hover:bg-muted hover:text-foreground'}"
                aria-label={m.admin_usersFilterStatus()}
                aria-pressed={Boolean(statusFilter)}
              >
                <span>
                  {statusFilter === "active"
                    ? m.admin_usersStatusActive()
                    : statusFilter === "disabled"
                      ? m.admin_usersStatusDisabled()
                      : m.admin_usersStatus()}
                </span>
                <ListFilter aria-hidden="true" class="size-3.5 shrink-0" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  sideOffset={6}
                  align="start"
                  role="dialog"
                  aria-label={m.admin_usersFilterStatus()}
                  class="z-50 w-48 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                >
                  <p class="px-2 pb-1.5 pt-1 text-caption font-medium text-muted-foreground">
                    {m.admin_usersFilterStatus()}
                  </p>
                  {#each statusFilterOptions as option}
                    <button
                      type="button"
                      class="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-body-sm font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={statusFilter === option.value}
                      onclick={() => applyStatusFilter(option.value)}
                    >
                      {option.label()}
                      {#if statusFilter === option.value}
                        <CircleCheck aria-hidden="true" class="size-4 text-primary" />
                      {/if}
                    </button>
                  {/each}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </th>
        <th
          class="px-5 py-3 font-medium"
          aria-sort={createdAtOrder === "asc" ? "ascending" : "descending"}
        >
          <Popover.Root bind:open={createdAtOrderOpen}>
            <Popover.Trigger
              type="button"
              class="-ml-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-1 font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={m.admin_usersSortCreated()}
            >
              <span>{m.admin_usersCreated()}</span>
              {#if createdAtOrder === "asc"}
                <ArrowUp aria-hidden="true" class="size-3.5" />
              {:else}
                <ArrowDown aria-hidden="true" class="size-3.5" />
              {/if}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={6}
                align="start"
                role="dialog"
                aria-label={m.admin_usersSortCreated()}
                class="z-50 w-48 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
              >
                <p class="px-2 pb-1.5 pt-1 text-caption font-medium text-muted-foreground">
                  {m.admin_usersSortCreated()}
                </p>
                {#each createdAtOrderOptions as option}
                  <button
                    type="button"
                    class="flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-body-sm font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-pressed={createdAtOrder === option.value}
                    onclick={() => applyCreatedAtOrder(option.value)}
                  >
                    {option.label()}
                    {#if createdAtOrder === option.value}
                      <CircleCheck aria-hidden="true" class="size-4 text-primary" />
                    {/if}
                  </button>
                {/each}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </th>
        <th class="px-5 py-3 text-right font-medium">
          <span class="inline-flex items-center gap-1">
            <UserCog
              aria-hidden="true"
              class="h-3.5 w-3.5 text-muted-foreground"
            />{m.admin_usersActions()}
          </span>
        </th>
      </tr>
    </thead>
    <tbody>
      {#if users.length === 0}
        <tr>
          <td colspan="9" class="px-5 py-12 text-center">
            <p class="font-medium">{m.admin_usersEmpty()}</p>
            <p class="mt-1 text-caption text-muted-foreground">{m.admin_usersEmptyHint()}</p>
          </td>
        </tr>
      {/if}
      {#each users as user (user.id)}
        <tr class="border-b border-border-subtle last:border-b-0">
          <td class="px-5 py-3">
            {#if canManage(user)}
              <input
                type="checkbox"
                class="size-4 cursor-pointer accent-primary"
                checked={selected.has(user.id)}
                aria-label={m.admin_usersSelectRow({ username: displayName(user) })}
                onchange={() => toggleRow(user.id)}
              />
            {/if}
          </td>
          <td class="px-5 py-3 font-mono text-caption">{user.username ?? "—"}</td>
          <td class="px-5 py-3">{user.email}</td>
          <td class="px-5 py-3">{user.name}</td>
          <td class="px-5 py-3">
            {#if canManage(user)}
              <form
                class="inline"
                method="POST"
                action="?/updateRole"
                use:enhance={roleSubmission(user)}
              >
                <input type="hidden" name="userId" value={user.id} />
                <select
                  name="role"
                  value={user.platformRole}
                  aria-label={`${m.admin_usersRole()}: ${displayName(user)}`}
                  class="rounded-none border-0 border-b border-border bg-transparent px-1 py-1 text-caption font-medium focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onchange={(e) => handleRoleChange(e, user)}
                >
                  {#each assignableRoles as role (role)}
                    <option value={role}>{roleLabel(role)}</option>
                  {/each}
                </select>
              </form>
            {:else}
              <Badge variant={roleBadgeVariant(user.platformRole)} size="sm">
                {roleLabel(user.platformRole)}
              </Badge>
            {/if}
          </td>
          <td class="px-5 py-3">
            {#if user.platformRole === "admin"}
              <Badge variant="success" size="sm">{m.admin_usersAdvancedAllowed()}</Badge>
            {:else if canManage(user)}
              <form
                class="inline"
                method="POST"
                action="?/updateAdvancedCreation"
                use:enhance={advancedSubmission(user)}
              >
                <input type="hidden" name="userId" value={user.id} />
                <select
                  name="allowed"
                  value={String(user.canCreateAdvancedProblems)}
                  aria-label={`${m.admin_usersAdvancedColumn()}: ${displayName(user)}`}
                  class="rounded-none border-0 border-b border-border bg-transparent px-1 py-1 text-caption font-medium focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
                >
                  <option value="true">{m.admin_usersAdvancedAllowed()}</option>
                  <option value="false">{m.admin_usersAdvancedDenied()}</option>
                </select>
              </form>
            {:else}
              <Badge variant={user.canCreateAdvancedProblems ? "success" : "outline"} size="sm">
                {user.canCreateAdvancedProblems
                  ? m.admin_usersAdvancedAllowed()
                  : m.admin_usersAdvancedDenied()}
              </Badge>
            {/if}
          </td>
          <td class="px-5 py-3">
            <span
              class="inline-flex items-center gap-2 text-caption font-medium {user.disabled
                ? 'text-destructive'
                : 'text-muted-foreground'}"
            >
              <span
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full {user.disabled
                  ? 'bg-destructive'
                  : 'bg-success'}"
              ></span>
              {user.disabled ? m.admin_usersStatusDisabled() : m.admin_usersStatusActive()}
            </span>
          </td>
          <td class="px-5 py-3 text-caption text-muted-foreground">
            {formatDate(user.createdAt)}
          </td>
          <td class="px-5 py-3 text-right">
            {#if canManage(user)}
              <div class="inline-flex items-center justify-end gap-1">
                <form
                  method="POST"
                  action="?/toggleDisabled"
                  use:enhance={() => {
                    const name = displayName(user);
                    const willDisable = !user.disabled;
                    return async ({ result, update }) => {
                      if (result.type === "success") {
                        toasts.success(
                          willDisable
                            ? m.admin_usersDisableSuccess({ username: name })
                            : m.admin_usersEnableSuccess({ username: name }),
                        );
                        await update();
                      } else if (result.type === "failure") {
                        const err =
                          (result.data as { error?: string } | undefined)?.error ??
                          m.admin_usersDisableFailed();
                        toasts.error(err);
                      } else {
                        await update();
                      }
                    };
                  }}
                >
                  <input type="hidden" name="userId" value={user.id} />
                  <button
                    type="submit"
                    class="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={user.disabled ? m.admin_usersEnable() : m.admin_usersDisable()}
                    title={user.disabled ? m.admin_usersEnable() : m.admin_usersDisable()}
                    onclick={(e) => maybeConfirmDisable(e, user)}
                  >
                    {#if user.disabled}
                      <CircleCheck aria-hidden="true" class="h-4 w-4" />
                    {:else}
                      <Ban aria-hidden="true" class="h-4 w-4" />
                    {/if}
                  </button>
                </form>
                <form
                  method="POST"
                  action="?/deleteUser"
                  use:enhance={() => {
                    const name = displayName(user);
                    return async ({ result, update }) => {
                      if (result.type === "success") {
                        toasts.success(m.admin_usersDeleteSuccess({ username: name }));
                        await update();
                      } else if (result.type === "failure") {
                        const err =
                          (result.data as { error?: string } | undefined)?.error ??
                          m.admin_usersDeleteFailed();
                        toasts.error(err);
                      } else {
                        await update();
                      }
                    };
                  }}
                >
                  <input type="hidden" name="userId" value={user.id} />
                  <button
                    type="submit"
                    class="inline-flex size-8 items-center justify-center rounded-sm text-destructive transition-colors hover:bg-destructive/10"
                    aria-label={m.admin_usersDeleteAccount()}
                    title={m.admin_usersDeleteAccount()}
                    onclick={(e) => confirmDelete(e, user)}
                  >
                    <Trash2 aria-hidden="true" class="h-4 w-4" />
                  </button>
                </form>
              </div>
            {:else}
              <span class="text-caption text-muted-foreground">—</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<ConfirmDialog
  open={pending !== null}
  title={pending?.title ?? ""}
  message={pending?.message ?? ""}
  confirmText={pending?.confirmText ?? m.common_confirm()}
  variant={pending?.variant ?? "default"}
  onconfirm={runConfirm}
  oncancel={cancelConfirm}
/>
