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
  import { CalendarClock, Mail, User, UserCog } from "@lucide/svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/components/primitives/ui/toast";
  import { formatDate } from "$lib/utils/datetime";

  interface Props {
    users: UsersTableUser[];
    actorId: string | undefined;
  }

  let { users, actorId }: Props = $props();

  let editingUserId = $state<string | null>(null);
  let draftRole = $state<PlatformRole>("student");

  function beginEditRole(user: { id: string; platformRole: PlatformRole }) {
    editingUserId = user.id;
    draftRole = user.platformRole;
  }

  function cancelEditRole() {
    editingUserId = null;
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
</script>

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
        <th class="px-5 py-3 font-medium">
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
            {#if editingUserId === user.id}
              <form
                method="POST"
                action="?/updateRole"
                class="flex flex-col gap-2"
                use:enhance={({ cancel, formData }) => {
                  const submittedRole = String(formData.get("role") ?? "");
                  const targetUsername = user.username ?? user.name;

                  if (user.id === actorId) {
                    toasts.error(m.admin_usersRoleSelfBlocked());
                    cancel();
                    return;
                  }

                  if (user.platformRole === "admin" && submittedRole !== "admin") {
                    const ok = confirm(
                      m.admin_usersRoleDemoteConfirm({
                        username: targetUsername,
                        to: submittedRole,
                      }),
                    );
                    if (!ok) {
                      cancel();
                      return;
                    }
                  }

                  return async ({ result, update }) => {
                    if (result.type === "success") {
                      toasts.success(
                        m.admin_usersRoleUpdateSuccess({
                          username: targetUsername,
                          to: submittedRole,
                        }),
                      );
                      editingUserId = null;
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
                <input type="hidden" name="role" value={draftRole} />
                <select
                  class="rounded-sm border border-input bg-background px-2 py-1 text-caption"
                  bind:value={draftRole}
                >
                  <option value="admin">{m.common_roleAdmin()}</option>
                  <option value="teacher">{m.common_roleTeacher()}</option>
                  <option value="student">{m.common_roleStudent()}</option>
                </select>
                {#if draftRole !== user.platformRole}
                  <p class="text-caption text-muted-foreground">
                    {m.admin_usersRoleChangeDiff({
                      username: user.username ?? user.name,
                      from: user.platformRole,
                      to: draftRole,
                    })}
                  </p>
                {/if}
                <div class="flex items-center gap-1">
                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={draftRole === user.platformRole}
                  >
                    {m.common_save()}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onclick={cancelEditRole}>
                    {m.common_cancel()}
                  </Button>
                </div>
              </form>
            {:else}
              <button
                type="button"
                class="inline-flex cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={m.admin_usersRoleEdit()}
                onclick={() => beginEditRole({ id: user.id, platformRole: user.platformRole })}
              >
                <Badge variant={roleBadgeVariant(user.platformRole)} size="sm">
                  {roleLabel(user.platformRole)}
                </Badge>
              </button>
            {/if}
          </td>
          <td class="px-5 py-3">
            {#if user.disabled}
              <Badge variant="destructive" size="xs">{m.admin_usersDisabled()}</Badge>
            {:else}
              <Badge variant="success" size="xs" dot>{m.admin_usersActive()}</Badge>
            {/if}
          </td>
          <td class="px-5 py-3 text-caption text-muted-foreground">
            {formatDate(user.createdAt)}
          </td>
          <td class="px-5 py-3">
            <form
              method="POST"
              action="?/toggleDisabled"
              use:enhance={({ cancel }) => {
                const targetUsername = user.username ?? user.name;
                const willDisable = !user.disabled;

                if (user.id === actorId) {
                  toasts.error(m.admin_usersDisableSelfBlocked());
                  cancel();
                  return;
                }

                if (willDisable) {
                  const ok = confirm(m.admin_usersDisableConfirm({ username: targetUsername }));
                  if (!ok) {
                    cancel();
                    return;
                  }
                }

                return async ({ result, update }) => {
                  if (result.type === "success") {
                    toasts.success(
                      willDisable
                        ? m.admin_usersDisableSuccess({ username: targetUsername })
                        : m.admin_usersEnableSuccess({ username: targetUsername }),
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
              <Button
                type="submit"
                variant={user.disabled ? "outline" : "ghost"}
                size="sm"
                class={user.disabled
                  ? "text-success hover:bg-success/10"
                  : "text-destructive hover:bg-destructive/10"}
              >
                {user.disabled ? m.admin_usersEnable() : m.admin_usersDisable()}
              </Button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
