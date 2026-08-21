<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Search, X } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import * as Select from "$lib/components/primitives/ui/select";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import BulkHandleAddPanel from "$lib/components/features/course/BulkHandleAddPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { formatDate } from "$lib/utils/datetime";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { members, bulkAddForm } = $derived(data);
  const isManager = $derived(data.isManager);

  type RoleFilter = "all" | "teacher" | "ta" | "student";

  let roleFilter = $state<RoleFilter>("all");
  let search = $state("");

  const filtered = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (roleFilter !== "all" && member.role !== roleFilter) return false;
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

  function updateRoleFilter(value: string | undefined): void {
    roleFilter = !value || value === "__all" ? "all" : (value as RoleFilter);
  }
</script>

<PageContainer class="space-y-8">
  {#if isManager}
    <BulkHandleAddPanel form={bulkAddForm} />
  {/if}

  <div class="animate-in animate-in-3">
    {#if filtered.length === 0}
      <div
        class="rounded-xl border border-dashed border-border px-6 py-10 text-center text-body-sm text-muted-foreground"
      >
        {m.members_empty()}
      </div>
    {:else}
      <div
        class="overflow-hidden rounded-xl border border-border bg-[color:var(--color-panel)]"
      >
        <div
          class="grid items-center gap-4 border-b border-border-subtle px-6 py-2 font-mono text-micro uppercase tracking-wider text-muted-foreground"
          style="grid-template-columns: auto minmax(0, 1fr) {isManager
            ? 'minmax(0, 1fr)'
            : ''} auto auto auto;"
        >
          <span aria-hidden="true"></span>
          <div class="relative min-w-0">
            <Search
              class="pointer-events-none absolute left-0 top-1/2 size-3.5 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              bind:value={search}
              placeholder={m.members_searchPlaceholder()}
              aria-label={m.members_searchPlaceholder()}
              class="w-full rounded-none border-0 border-b border-border bg-transparent py-2 pl-6 pr-1 font-mono text-micro uppercase tracking-wider shadow-none focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0"
            />
          </div>
          {#if isManager}<span aria-hidden="true"></span>{/if}
          <span aria-hidden="true"></span>
          <Select.Root
            type="single"
            value={roleFilter === "all" ? "__all" : roleFilter}
            onValueChange={updateRoleFilter}
          >
            <Select.Trigger
              class="h-8 max-w-48 justify-end rounded-none border-0 border-b border-border bg-transparent px-1 font-mono text-micro uppercase tracking-wider shadow-none focus-visible:border-ring"
              aria-label={m.members_roleLabel()}
            >
              {#if roleFilter === "all"}
                {m.members_tabAll()}
              {:else if roleFilter === "teacher"}
                {m.members_tabTeachers()}
              {:else if roleFilter === "ta"}
                {m.members_tabTas()}
              {:else}
                {m.members_tabStudents()}
              {/if}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__all" label={m.members_tabAll()}
                >{m.members_tabAll()}</Select.Item
              >
              <Select.Item value="teacher" label={m.members_tabTeachers()}>
                {m.members_tabTeachers()}
              </Select.Item>
              <Select.Item value="ta" label={m.members_tabTas()}
                >{m.members_tabTas()}</Select.Item
              >
              <Select.Item value="student" label={m.members_tabStudents()}>
                {m.members_tabStudents()}
              </Select.Item>
            </Select.Content>
          </Select.Root>
          <span aria-hidden="true"></span>
        </div>
        {#each filtered as member (member.userId)}
          <div
            class="grid items-center gap-4 border-b border-border-subtle px-6 py-4 transition-colors duration-fast ease-out-soft last:border-b-0 hover:bg-primary/[0.03]"
            style="grid-template-columns: auto minmax(0, 1fr) {isManager
              ? 'minmax(0, 1fr)'
              : ''} auto auto auto;"
          >
            <div
              class="flex size-10 items-center justify-center rounded-full text-body font-semibold text-primary-foreground {member.isPlaceholder
                ? 'bg-primary opacity-50'
                : 'bg-primary'}"
              aria-hidden="true"
            >
              {member.isPlaceholder ? "?" : initialFor(member.name)}
            </div>

            <div class="min-w-0">
              <div
                class="truncate text-body {member.isPlaceholder
                  ? 'font-normal text-muted-foreground'
                  : 'font-semibold tracking-[-0.005em]'}"
              >
                {member.isPlaceholder ? m.members_placeholderNotLoggedIn() : member.name}
              </div>
              <div class="mt-0.5 truncate font-mono text-caption text-muted-foreground">
                {member.username ?? "—"}
              </div>
            </div>

            {#if isManager}
              <div
                class="truncate text-left font-mono text-caption text-muted-foreground"
                aria-label="email"
              >
                {member.email ?? "—"}
              </div>
            {/if}

            <div class="text-caption text-muted-foreground tabular-nums">
              {#if member.isPlaceholder}
                {m.members_placeholderJoined()}
              {:else}
                {formatJoined(member.joinedAt)}
              {/if}
            </div>

            {#if member.role === "teacher"}
              <span class="text-right text-caption font-medium text-primary">
                {m.members_roleTeacher()}
              </span>
            {:else if isManager}
              <select
                class="rounded-none border-0 border-b border-border bg-transparent py-1.5 pl-1 pr-2 text-right text-caption focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                aria-label={m.members_roleFor({ name: member.name })}
                value={member.role}
                onchange={(e) => handleRoleChange(e, member.userId, member.role)}
              >
                <option value="student">{m.members_roleStudent()}</option>
                <option value="ta">{m.members_roleTa()}</option>
              </select>
            {:else}
              <span class="text-caption text-muted-foreground">
                {member.role === "ta" ? m.members_roleTa() : m.members_roleStudent()}
              </span>
            {/if}

            {#if isManager && member.role !== "teacher"}
              <button
                type="button"
                class="rounded-sm bg-transparent p-1.5 text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-transparent hover:text-destructive"
                aria-label={m.members_removeAction()}
                title={m.members_removeAction()}
                onclick={() => (pendingRemove = { userId: member.userId, name: member.name })}
              >
                <X aria-hidden="true" class="size-4" />
              </button>
            {:else}
              <span></span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if isManager}
      <p class="mt-4 text-center text-caption text-muted-foreground">
        {m.members_placeholderFooter()}
      </p>
    {/if}
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
