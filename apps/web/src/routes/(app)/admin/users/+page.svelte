<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { Badge } from "$lib/components/ui/badge";

  let { data } = $props();

  let searchValue = $state(untrack(() => data.search));
  let roleValue = $state(untrack(() => data.roleFilter));

  function applyFilters() {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (roleValue) params.set("role", roleValue);
    goto(`/admin/users?${params.toString()}`);
  }
</script>

<div class="space-y-4">
  <!-- Filters -->
  <div
    class="flex flex-wrap items-end gap-3 rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-4 backdrop-blur-sm"
  >
    <div class="flex-1">
      <label class="mb-1 block text-sm font-medium" for="search">Search</label>
      <input
        id="search"
        class="w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
        placeholder="Search by username, email, or name..."
        type="text"
        bind:value={searchValue}
        onkeydown={(e) => e.key === "Enter" && applyFilters()}
      />
    </div>
    <div>
      <label class="mb-1 block text-sm font-medium" for="role-filter">Role</label>
      <select
        id="role-filter"
        class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
        bind:value={roleValue}
        onchange={applyFilters}
      >
        <option value="">All roles</option>
        <option value="admin">Admin</option>
        <option value="teacher">Teacher</option>
        <option value="student">Student</option>
      </select>
    </div>
    <button
      class="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5"
      type="button"
      onclick={applyFilters}
    >
      Search
    </button>
  </div>

  <!-- Results count -->
  <p class="text-sm text-muted-foreground">
    {data.totalCount} user{data.totalCount === 1 ? "" : "s"} found &middot; Page {data.page} of {data.totalPages}
  </p>

  <!-- Users table -->
  <div
    class="overflow-x-auto rounded-xl border border-border bg-[color:var(--color-panel)] backdrop-blur-sm"
  >
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-border text-left">
          <th class="px-5 py-3 font-medium">Username</th>
          <th class="px-5 py-3 font-medium">Email</th>
          <th class="px-5 py-3 font-medium">Name</th>
          <th class="px-5 py-3 font-medium">Role</th>
          <th class="px-5 py-3 font-medium">Status</th>
          <th class="px-5 py-3 font-medium">Created</th>
          <th class="px-5 py-3 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each data.users as user (user.id)}
          <tr class="border-b border-border last:border-b-0">
            <td class="px-5 py-3 font-mono text-xs">{user.username ?? "—"}</td>
            <td class="px-5 py-3">{user.email}</td>
            <td class="px-5 py-3">{user.name}</td>
            <td class="px-5 py-3">
              <form method="POST" action="?/updateRole" use:enhance>
                <input type="hidden" name="userId" value={user.id} />
                <select
                  class="rounded-lg border border-border bg-[color:var(--color-panel)] px-2 py-1 text-xs"
                  name="role"
                  value={user.platformRole}
                  onchange={(e) => e.currentTarget.form?.requestSubmit()}
                >
                  <option value="admin">admin</option>
                  <option value="teacher">teacher</option>
                  <option value="student">student</option>
                </select>
              </form>
            </td>
            <td class="px-5 py-3">
              {#if user.disabled}
                <Badge variant="destructive">Disabled</Badge>
              {:else}
                <Badge variant="secondary">Active</Badge>
              {/if}
            </td>
            <td class="px-5 py-3 text-xs text-muted-foreground">
              {new Date(user.createdAt).toLocaleDateString()}
            </td>
            <td class="px-5 py-3">
              <form method="POST" action="?/toggleDisabled" use:enhance>
                <input type="hidden" name="userId" value={user.id} />
                <button
                  class="rounded-full border border-border px-3 py-1 text-xs transition hover:-translate-y-0.5 {user.disabled ? 'hover:bg-emerald-500/10' : 'hover:bg-destructive/10'}"
                  type="submit"
                >
                  {user.disabled ? "Enable" : "Disable"}
                </button>
              </form>
            </td>
          </tr>
        {:else}
          <tr>
            <td class="px-5 py-8 text-center text-muted-foreground" colspan="7">No users found.</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Pagination -->
  {#if data.totalPages > 1}
    <div class="flex items-center justify-center gap-2">
      {#if data.page > 1}
        <a
          class="rounded-full border border-border px-4 py-2 text-sm transition hover:-translate-y-0.5 hover:bg-accent"
          href="/admin/users?page={data.page - 1}{data.search ? `&search=${data.search}` : ''}{data.roleFilter ? `&role=${data.roleFilter}` : ''}"
        >
          Previous
        </a>
      {/if}
      <span class="px-3 py-2 text-sm text-muted-foreground">
        {data.page} / {data.totalPages}
      </span>
      {#if data.page < data.totalPages}
        <a
          class="rounded-full border border-border px-4 py-2 text-sm transition hover:-translate-y-0.5 hover:bg-accent"
          href="/admin/users?page={data.page + 1}{data.search ? `&search=${data.search}` : ''}{data.roleFilter ? `&role=${data.roleFilter}` : ''}"
        >
          Next
        </a>
      {/if}
    </div>
  {/if}
</div>
