<script lang="ts">
  import { browser } from "$app/environment";
  import { untrack } from "svelte";
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { CalendarClock, Languages, Mail, Search, Shield, User, UserCog, Users } from "@lucide/svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import Section from "$lib/components/ui/Section.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import FormField from "$lib/components/ui/FormField.svelte";
  import { m } from "$lib/paraglide/messages.js";

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

<svelte:head>
  <!-- Snapshot search + scroll state across soft-navs (e.g. filter roundtrips) -->
</svelte:head>

<Section class="space-y-4">
  {#snippet header()}
    <h2 class="inline-flex items-center gap-2">
      <Users class="h-5 w-5 text-muted-foreground" />
      {m.admin_usersTitle()}
    </h2>
    <p>
      {data.totalCount}
      {data.totalCount === 1 ? t("userFound") : t("usersFound")} &middot;
      {t("page")} {data.page} {t("of")} {data.totalPages}
    </p>
  {/snippet}
  {#snippet actions()}
    <div class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-muted/30 p-1">
      <span class="inline-flex items-center gap-1 px-2 text-caption text-muted-foreground">
        <Languages class="h-3.5 w-3.5" /> {t("systemText")}
      </span>
      <button
        type="button"
        class="min-h-9 rounded-full px-3 py-1 text-caption font-medium transition-colors duration-fast ease-out-soft {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => setUiLang("zh")}
      >
        {t("zh")}
      </button>
      <button
        type="button"
        class="min-h-9 rounded-full px-3 py-1 text-caption font-medium transition-colors duration-fast ease-out-soft {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => setUiLang("en")}
      >
        {t("english")}
      </button>
    </div>
  {/snippet}

  <Card variant="flat" size="md">
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-[240px] flex-1">
        <FormField label={t("search")} for="search">
          <Input
            id="search"
            placeholder={t("searchPlaceholder")}
            type="text"
            bind:value={searchValue}
            onkeydown={(e) => e.key === "Enter" && applyFilters()}
          />
        </FormField>
      </div>
      <div>
        <label
          class="mb-1.5 inline-flex items-center gap-1 text-body-sm font-medium"
          for="role-filter"
        >
          <Shield class="h-3.5 w-3.5 text-muted-foreground" /> {t("role")}
        </label>
        <select
          id="role-filter"
          class="flex h-11 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          bind:value={roleValue}
          onchange={applyFilters}
        >
          <option value="">{t("allRoles")}</option>
          <option value="admin">Admin</option>
          <option value="teacher">Teacher</option>
          <option value="student">Student</option>
        </select>
      </div>
      <Button variant="default" type="button" onclick={applyFilters}>
        <Search class="h-4 w-4" />
        {t("search")}
      </Button>
    </div>
  </Card>

  <!-- Users table -->
  <Card variant="surface" size="lg" class="overflow-hidden p-0">
    {#if data.users.length === 0}
      <EmptyState
        variant="minimal"
        icon={Users}
        title={m.admin_usersEmpty()}
        description={m.admin_usersEmptyHint()}
      />
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead>
            <tr class="border-b border-border-subtle text-left">
              <th class="px-5 py-3 font-medium">
                <span class="inline-flex items-center gap-1">
                  <User class="h-3.5 w-3.5 text-muted-foreground" />{t("username")}
                </span>
              </th>
              <th class="px-5 py-3 font-medium">
                <span class="inline-flex items-center gap-1">
                  <Mail class="h-3.5 w-3.5 text-muted-foreground" />{t("email")}
                </span>
              </th>
              <th class="px-5 py-3 font-medium">{t("name")}</th>
              <th class="px-5 py-3 font-medium">{t("role")}</th>
              <th class="px-5 py-3 font-medium">{t("status")}</th>
              <th class="px-5 py-3 font-medium">
                <span class="inline-flex items-center gap-1">
                  <CalendarClock class="h-3.5 w-3.5 text-muted-foreground" />{t("created")}
                </span>
              </th>
              <th class="px-5 py-3 font-medium">
                <span class="inline-flex items-center gap-1">
                  <UserCog class="h-3.5 w-3.5 text-muted-foreground" />{t("actions")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each data.users as user (user.id)}
              <tr class="border-b border-border-subtle last:border-b-0">
                <td class="px-5 py-3 font-mono text-caption">{user.username ?? "—"}</td>
                <td class="px-5 py-3">{user.email}</td>
                <td class="px-5 py-3">{user.name}</td>
                <td class="px-5 py-3">
                  <form method="POST" action="?/updateRole" use:enhance>
                    <input type="hidden" name="userId" value={user.id} />
                    <select
                      class="rounded-sm border border-input bg-background px-2 py-1 text-caption"
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
                    <Badge variant="destructive" size="xs">{t("disabled")}</Badge>
                  {:else}
                    <Badge variant="success" size="xs" dot>{t("active")}</Badge>
                  {/if}
                </td>
                <td class="px-5 py-3 text-caption text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td class="px-5 py-3">
                  <form method="POST" action="?/toggleDisabled" use:enhance>
                    <input type="hidden" name="userId" value={user.id} />
                    <Button
                      type="submit"
                      variant={user.disabled ? "outline" : "ghost"}
                      size="sm"
                      class={user.disabled
                        ? "text-success hover:bg-success/10"
                        : "text-destructive hover:bg-destructive/10"}
                    >
                      {user.disabled ? t("enable") : t("disable")}
                    </Button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>

  <!-- Pagination -->
  {#if data.totalPages > 1}
    <div class="flex items-center justify-center gap-2">
      {#if data.page > 1}
        <Button
          variant="outline"
          size="sm"
          href="/admin/users?page={data.page - 1}{data.search
            ? `&search=${data.search}`
            : ''}{data.roleFilter ? `&role=${data.roleFilter}` : ''}"
        >
          {t("previous")}
        </Button>
      {/if}
      <span class="px-3 py-2 text-body-sm text-muted-foreground tabular-nums">
        {data.page} / {data.totalPages}
      </span>
      {#if data.page < data.totalPages}
        <Button
          variant="outline"
          size="sm"
          href="/admin/users?page={data.page + 1}{data.search
            ? `&search=${data.search}`
            : ''}{data.roleFilter ? `&role=${data.roleFilter}` : ''}"
        >
          {t("next")}
        </Button>
      {/if}
    </div>
  {/if}
</Section>
