<script module lang="ts">
  import type { PlatformRole } from "@nojv/core";

  export interface UsersTableUser {
    id: string;
    username: string | null;
    email: string;
    name: string;
    platformRole: PlatformRole;
    disabled: boolean;
    createdAt: Date | string;
  }
</script>

<script lang="ts">
  import { enhance } from "$app/forms";
  import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    CalendarClock,
    Mail,
    MoreHorizontal,
    Trash2,
    User,
    UserCog,
  } from "@lucide/svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/components/primitives/ui/toast";
  import { formatDate } from "$lib/utils/datetime";

  interface Props {
    users: UsersTableUser[];
    actorId: string | undefined;
    canManageAdmins: boolean;
  }

  let { users, actorId, canManageAdmins }: Props = $props();

  let openMenuId = $state<string | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>();
  let triggerEl = $state<HTMLButtonElement | undefined>();

  function toggleMenu(id: string, e: MouseEvent) {
    if (openMenuId === id) {
      closeMenu();
    } else {
      openMenuId = id;
      triggerEl = e.currentTarget as HTMLButtonElement;
    }
  }

  function closeMenu() {
    openMenuId = null;
  }

  $effect(() => {
    if (openMenuId === null) return;
    menuEl?.querySelector<HTMLElement>("[role='menuitem']:not([disabled])")?.focus();
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const t = triggerEl;
        closeMenu();
        t?.focus();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });

  function onMenuKeydown(e: KeyboardEvent) {
    if (!menuEl) return;
    const items = Array.from(
      menuEl.querySelectorAll<HTMLElement>("[role='menuitem']:not([disabled])"),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
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

  function roleRank(role: PlatformRole): number {
    if (role === "admin") return 2;
    if (role === "teacher") return 1;
    return 0;
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

  type SortKey = "username" | "email" | "name" | "role" | "status" | "createdAt";
  let sortKey = $state<SortKey | null>(null);
  let sortDir = $state<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "asc";
    }
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (sortKey !== key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  }

  const sortedUsers = $derived.by(() => {
    const key = sortKey;
    if (!key) return users;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...users].sort((a, b) => {
      let cmp = 0;
      if (key === "role") {
        cmp = roleRank(a.platformRole) - roleRank(b.platformRole);
      } else if (key === "status") {
        cmp = Number(a.disabled) - Number(b.disabled);
      } else if (key === "createdAt") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (key === "username") {
        cmp = (a.username ?? "").localeCompare(b.username ?? "");
      } else {
        cmp = a[key].localeCompare(b[key]);
      }
      return cmp * dir;
    });
  });

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

  function maybeConfirmRole(e: MouseEvent, user: UsersTableUser, targetRole: PlatformRole) {
    const isDangerous = user.platformRole === "admin" || targetRole === "admin";
    if (!isDangerous) return;
    requestConfirm(e, {
      title: m.admin_usersRoleChangeTitle(),
      message: m.admin_usersRoleChangeConfirm({
        username: displayName(user),
        to: roleLabel(targetRole),
      }),
      confirmText: m.common_confirm(),
      variant: "default",
    });
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
</script>

<svelte:window
  onclick={(e) => {
    if (openMenuId === null || pending !== null) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[role='menu']") && !target.closest("[aria-haspopup='menu']")) {
      closeMenu();
    }
  }}
/>

<div class="overflow-x-auto">
  <table class="w-full text-body-sm">
    <thead>
      <tr class="border-b border-border-subtle text-left">
        <th class="px-5 py-3 font-medium" aria-sort={ariaSort("username")}>
          <button
            type="button"
            class="group -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggleSort("username")}
          >
            <User aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
            {m.admin_usersUsername()}
            {@render sortArrow("username")}
          </button>
        </th>
        <th class="px-5 py-3 font-medium" aria-sort={ariaSort("email")}>
          <button
            type="button"
            class="group -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggleSort("email")}
          >
            <Mail aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
            {m.admin_usersEmail()}
            {@render sortArrow("email")}
          </button>
        </th>
        <th class="px-5 py-3 font-medium" aria-sort={ariaSort("name")}>
          <button
            type="button"
            class="group -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggleSort("name")}
          >
            {m.admin_usersName()}
            {@render sortArrow("name")}
          </button>
        </th>
        <th class="px-5 py-3 font-medium" aria-sort={ariaSort("role")}>
          <button
            type="button"
            class="group -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggleSort("role")}
          >
            {m.admin_usersRole()}
            {@render sortArrow("role")}
          </button>
        </th>
        <th class="px-5 py-3 font-medium" aria-sort={ariaSort("status")}>
          <button
            type="button"
            class="group -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggleSort("status")}
          >
            {m.admin_usersStatus()}
            {@render sortArrow("status")}
          </button>
        </th>
        <th class="px-5 py-3 font-medium" aria-sort={ariaSort("createdAt")}>
          <button
            type="button"
            class="group -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => toggleSort("createdAt")}
          >
            <CalendarClock aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
            {m.admin_usersCreated()}
            {@render sortArrow("createdAt")}
          </button>
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
      {#each sortedUsers as user (user.id)}
        <tr class="border-b border-border-subtle last:border-b-0">
          <td class="px-5 py-3 font-mono text-caption">{user.username ?? "—"}</td>
          <td class="px-5 py-3">{user.email}</td>
          <td class="px-5 py-3">{user.name}</td>
          <td class="px-5 py-3">
            <Badge variant={roleBadgeVariant(user.platformRole)} size="sm">
              {roleLabel(user.platformRole)}
            </Badge>
          </td>
          <td class="px-5 py-3">
            {#if user.disabled}
              <Badge variant="destructive" size="xs">{m.admin_usersStatusDisabled()}</Badge>
            {:else}
              <Badge variant="success" size="xs" dot>{m.admin_usersStatusActive()}</Badge>
            {/if}
          </td>
          <td class="px-5 py-3 text-caption text-muted-foreground">
            {formatDate(user.createdAt)}
          </td>
          <td class="px-5 py-3 text-right">
            {#if canManage(user)}
              <div class="relative inline-block text-left">
                <button
                  type="button"
                  class="inline-flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={m.admin_usersActions()}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === user.id}
                  onclick={(e) => toggleMenu(user.id, e)}
                >
                  <MoreHorizontal aria-hidden="true" class="h-4 w-4" />
                </button>

                {#if openMenuId === user.id}
                  <div
                    bind:this={menuEl}
                    class="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover py-1 text-left text-popover-foreground shadow-modal"
                    role="menu"
                    tabindex="-1"
                    onkeydown={onMenuKeydown}
                  >
                    <p
                      class="px-3 py-1.5 text-caption font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {m.admin_usersRole()}
                    </p>
                    {#each assignableRoles as targetRole (targetRole)}
                      <form
                        method="POST"
                        action="?/updateRole"
                        use:enhance={() => {
                          const name = displayName(user);
                          closeMenu();
                          return async ({ result, update }) => {
                            if (result.type === "success") {
                              toasts.success(
                                m.admin_usersRoleUpdateSuccess({
                                  username: name,
                                  to: roleLabel(targetRole),
                                }),
                              );
                              await update();
                            } else if (result.type === "failure") {
                              const err =
                                (result.data as { error?: string } | undefined)?.error ??
                                m.admin_usersRoleUpdateFailed();
                              toasts.error(err);
                            } else {
                              await update();
                            }
                          };
                        }}
                      >
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="role" value={targetRole} />
                        <button
                          type="submit"
                          class="flex w-full items-center justify-between gap-2 px-3 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                          disabled={targetRole === user.platformRole}
                          role="menuitem"
                          onclick={(e) => maybeConfirmRole(e, user, targetRole)}
                        >
                          <span>{roleLabel(targetRole)}</span>
                          {#if targetRole === user.platformRole}
                            <span class="text-caption text-muted-foreground">•</span>
                          {/if}
                        </button>
                      </form>
                    {/each}

                    <div class="my-1 border-t border-border-subtle"></div>

                    <form
                      method="POST"
                      action="?/toggleDisabled"
                      use:enhance={() => {
                        const name = displayName(user);
                        const willDisable = !user.disabled;
                        closeMenu();
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
                        class="flex w-full items-center px-3 py-2 text-body-sm transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
                        role="menuitem"
                        onclick={(e) => maybeConfirmDisable(e, user)}
                      >
                        {user.disabled ? m.admin_usersEnable() : m.admin_usersDisable()}
                      </button>
                    </form>

                    <form
                      method="POST"
                      action="?/deleteUser"
                      use:enhance={() => {
                        const name = displayName(user);
                        closeMenu();
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
                        class="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-destructive transition-colors duration-fast ease-out-soft hover:bg-destructive/10"
                        role="menuitem"
                        onclick={(e) => confirmDelete(e, user)}
                      >
                        <Trash2 aria-hidden="true" class="h-3.5 w-3.5" />
                        {m.admin_usersDeleteAccount()}
                      </button>
                    </form>
                  </div>
                {/if}
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
  oncancel={() => (pending = null)}
/>

{#snippet sortArrow(key: SortKey)}
  {#if sortKey === key}
    {#if sortDir === "asc"}
      <ArrowUp aria-hidden="true" class="h-3 w-3" />
    {:else}
      <ArrowDown aria-hidden="true" class="h-3 w-3" />
    {/if}
  {:else}
    <ArrowUpDown
      aria-hidden="true"
      class="h-3 w-3 opacity-0 transition-opacity duration-fast group-hover:opacity-40"
    />
  {/if}
{/snippet}
