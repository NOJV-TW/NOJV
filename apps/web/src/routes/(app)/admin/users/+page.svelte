<script lang="ts">
  import { browser } from "$app/environment";
  import { untrack } from "svelte";
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { CalendarClock, Languages, Mail, Search, Shield, User, UserCog } from "@lucide/svelte";
  import { Badge } from "$lib/components/ui/badge";

  let { data } = $props();

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      actions: "Actions",
      active: "Active",
      allRoles: "All roles",
      created: "Created",
      disable: "Disable",
      disabled: "Disabled",
      email: "Email",
      enable: "Enable",
      english: "English",
      name: "Name",
      next: "Next",
      noUsers: "No users found.",
      of: "of",
      page: "Page",
      previous: "Previous",
      role: "Role",
      search: "Search",
      searchPlaceholder: "Search by username, email, or name...",
      status: "Status",
      systemText: "System Text",
      userFound: "user found",
      usersFound: "users found",
      username: "Username",
      zh: "中文"
    },
    zh: {
      actions: "操作",
      active: "啟用",
      allRoles: "全部角色",
      created: "建立時間",
      disable: "停用",
      disabled: "停用",
      email: "Email",
      enable: "啟用",
      english: "English",
      name: "名稱",
      next: "下一頁",
      noUsers: "找不到使用者。",
      of: "/",
      page: "第",
      previous: "上一頁",
      role: "角色",
      search: "搜尋",
      searchPlaceholder: "以使用者名稱、Email 或姓名搜尋...",
      status: "狀態",
      systemText: "系統文字",
      userFound: "位使用者",
      usersFound: "位使用者",
      username: "使用者名稱",
      zh: "中文"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  onMount(() => {
    if (!browser) return;
    const saved = localStorage.getItem("nojv-system-text-lang");
    if (saved === "zh" || saved === "en") {
      uiLang = saved;
    }
  });

  function setUiLang(next: UiLang): void {
    uiLang = next;
    if (browser) {
      localStorage.setItem("nojv-system-text-lang", next);
    }
  }

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
  <div class="flex justify-end">
    <div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
      <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
        <Languages class="h-3.5 w-3.5" /> {t("systemText")}
      </span>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => setUiLang("zh")}
      >
        {t("zh")}
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => setUiLang("en")}
      >
        {t("english")}
      </button>
    </div>
  </div>

  <div
    class="flex flex-wrap items-end gap-3 rounded-4xl border border-border bg-(--color-panel) px-5 py-4 backdrop-blur-sm"
  >
    <div class="flex-1">
      <label class="mb-1 inline-flex items-center gap-1 text-sm font-medium" for="search">
        <Search class="h-3.5 w-3.5 text-muted-foreground" /> {t("search")}
      </label>
      <input
        id="search"
        class="w-full rounded-2xl border border-border bg-(--color-panel) px-3 py-2 text-sm"
        placeholder={t("searchPlaceholder")}
        type="text"
        bind:value={searchValue}
        onkeydown={(e) => e.key === "Enter" && applyFilters()}
      />
    </div>
    <div>
      <label class="mb-1 inline-flex items-center gap-1 text-sm font-medium" for="role-filter">
        <Shield class="h-3.5 w-3.5 text-muted-foreground" /> {t("role")}
      </label>
      <select
        id="role-filter"
        class="rounded-2xl border border-border bg-(--color-panel) px-3 py-2 text-sm"
        bind:value={roleValue}
        onchange={applyFilters}
      >
        <option value="">{t("allRoles")}</option>
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
      {t("search")}
    </button>
  </div>

  <!-- Results count -->
  <p class="text-sm text-muted-foreground">
    {data.totalCount} {data.totalCount === 1 ? t("userFound") : t("usersFound")} &middot; {t("page")} {data.page} {t("of")} {data.totalPages}
  </p>

  <!-- Users table -->
  <div
    class="overflow-x-auto rounded-xl border border-border bg-(--color-panel) backdrop-blur-sm"
  >
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-border text-left">
          <th class="px-5 py-3 font-medium"><span class="inline-flex items-center gap-1"><User class="h-3.5 w-3.5 text-muted-foreground" />{t("username")}</span></th>
          <th class="px-5 py-3 font-medium"><span class="inline-flex items-center gap-1"><Mail class="h-3.5 w-3.5 text-muted-foreground" />{t("email")}</span></th>
          <th class="px-5 py-3 font-medium">{t("name")}</th>
          <th class="px-5 py-3 font-medium">{t("role")}</th>
          <th class="px-5 py-3 font-medium">{t("status")}</th>
          <th class="px-5 py-3 font-medium"><span class="inline-flex items-center gap-1"><CalendarClock class="h-3.5 w-3.5 text-muted-foreground" />{t("created")}</span></th>
          <th class="px-5 py-3 font-medium"><span class="inline-flex items-center gap-1"><UserCog class="h-3.5 w-3.5 text-muted-foreground" />{t("actions")}</span></th>
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
                  class="rounded-lg border border-border bg-(--color-panel) px-2 py-1 text-xs"
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
                <Badge variant="destructive">{t("disabled")}</Badge>
              {:else}
                <Badge variant="secondary">{t("active")}</Badge>
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
                  {user.disabled ? t("enable") : t("disable")}
                </button>
              </form>
            </td>
          </tr>
        {:else}
          <tr>
            <td class="px-5 py-8 text-center text-muted-foreground" colspan="7">{t("noUsers")}</td>
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
          {t("previous")}
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
          {t("next")}
        </a>
      {/if}
    </div>
  {/if}
</div>
