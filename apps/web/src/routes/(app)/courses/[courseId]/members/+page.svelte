<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { Search, X } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import FilterChips from "$lib/components/primitives/ui/FilterChips.svelte";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import BulkHandleAddPanel from "$lib/components/features/course/BulkHandleAddPanel.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { members, bulkAddForm } = $derived(data);
  const isManager = $derived(data.isManager);

  type RoleFilter = "all" | "teacher" | "ta" | "student";

  let roleFilter = $state<RoleFilter>("all");
  let search = $state("");

  const counts = $derived.by(() => {
    let all = 0;
    let teacher = 0;
    let ta = 0;
    let student = 0;
    for (const member of members) {
      all += 1;
      if (member.role === "teacher") teacher += 1;
      else if (member.role === "ta") ta += 1;
      else if (member.role === "student") student += 1;
    }
    return { all, teacher, ta, student };
  });

  const filterOptions = $derived([
    { value: "all", label: m.members_tabAll(), count: counts.all },
    { value: "teacher", label: m.members_tabTeachers(), count: counts.teacher },
    { value: "ta", label: m.members_tabTas(), count: counts.ta },
    { value: "student", label: m.members_tabStudents(), count: counts.student },
  ]);

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
    } catch {
      select.value = previousRole;
      toasts.error(m.members_roleChangeError());
    }
  }

  function formatJoined(iso: string): string {
    const d = new Date(iso);
    const date = `${d.getMonth() + 1}/${d.getDate()}`;
    return m.members_joinedOn({ date });
  }
</script>

<PageContainer class="space-y-8">
  {#if isManager}
    <BulkHandleAddPanel form={bulkAddForm} />
  {/if}

  <div class="animate-in animate-in-2 flex flex-wrap items-center gap-4">
    <FilterChips
      options={filterOptions}
      value={roleFilter}
      onChange={(next) => (roleFilter = next as RoleFilter)}
      ariaLabel={m.members_title()}
    />
    <div class="relative max-w-xs flex-1">
      <Search
        class="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="text"
        bind:value={search}
        placeholder={m.members_searchPlaceholder()}
        class="w-full rounded-md border border-border bg-[color:var(--color-panel)] py-2.5 pl-10 pr-3 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </div>
  </div>

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
                class="truncate font-mono text-caption text-muted-foreground"
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
              <span
                class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-caption font-medium text-primary"
              >
                {m.members_roleTeacher()}
              </span>
            {:else if isManager}
              <select
                class="rounded-md border border-border bg-transparent py-1.5 pl-3 pr-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
                class="rounded-sm p-1.5 text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-destructive/10 hover:text-destructive"
                aria-label={m.members_removeAction()}
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
