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
  import { CalendarClock, Mail, MoreHorizontal, Trash2, User, UserCog } from "@lucide/svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
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

  function toggleMenu(id: string) {
    openMenuId = openMenuId === id ? null : id;
  }

  function closeMenu() {
    openMenuId = null;
  }

  $effect(() => {
    if (openMenuId === null) return;
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });

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
</script>

<svelte:window
  onclick={(e) => {
    if (openMenuId === null) return;
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
        <th class="px-5 py-3 font-medium">
          <span class="inline-flex items-center gap-1">
            <User
              aria-hidden="true"
              class="h-3.5 w-3.5 text-muted-foreground"
            />{m.admin_usersUsername()}
          </span>
        </th>
        <th class="px-5 py-3 font-medium">
          <span class="inline-flex items-center gap-1">
            <Mail
              aria-hidden="true"
              class="h-3.5 w-3.5 text-muted-foreground"
            />{m.admin_usersEmail()}
          </span>
        </th>
        <th class="px-5 py-3 font-medium">{m.admin_usersName()}</th>
        <th class="px-5 py-3 font-medium">{m.admin_usersRole()}</th>
        <th class="px-5 py-3 font-medium">{m.admin_usersStatus()}</th>
        <th class="px-5 py-3 font-medium">
          <span class="inline-flex items-center gap-1">
            <CalendarClock
              aria-hidden="true"
              class="h-3.5 w-3.5 text-muted-foreground"
            />{m.admin_usersCreated()}
          </span>
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
      {#each users as user (user.id)}
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
                  onclick={() => toggleMenu(user.id)}
                >
                  <MoreHorizontal aria-hidden="true" class="h-4 w-4" />
                </button>

                {#if openMenuId === user.id}
                  <div
                    class="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover py-1 text-left text-popover-foreground shadow-modal"
                    role="menu"
                    tabindex="-1"
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
                        use:enhance={({ cancel }) => {
                          const name = displayName(user);
                          const isDangerous =
                            user.platformRole === "admin" || targetRole === "admin";
                          if (isDangerous) {
                            const ok = confirm(
                              m.admin_usersRoleChangeConfirm({
                                username: name,
                                to: roleLabel(targetRole),
                              }),
                            );
                            if (!ok) {
                              cancel();
                              return;
                            }
                          }
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
                      use:enhance={({ cancel }) => {
                        const name = displayName(user);
                        const willDisable = !user.disabled;
                        if (willDisable) {
                          const ok = confirm(m.admin_usersDisableConfirm({ username: name }));
                          if (!ok) {
                            cancel();
                            return;
                          }
                        }
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
                      >
                        {user.disabled ? m.admin_usersEnable() : m.admin_usersDisable()}
                      </button>
                    </form>

                    <form
                      method="POST"
                      action="?/deleteUser"
                      use:enhance={({ cancel }) => {
                        const name = displayName(user);
                        const ok = confirm(m.admin_usersDeleteConfirm({ username: name }));
                        if (!ok) {
                          cancel();
                          return;
                        }
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
