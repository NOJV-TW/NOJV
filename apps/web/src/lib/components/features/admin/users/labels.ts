import type { UiLang } from "$lib/components/features/admin/SystemTextToggle.svelte";

export type { UiLang };

export interface UsersPageLabels {
  actions: string;
  active: string;
  allRoles: string;
  created: string;
  disable: string;
  disabled: string;
  email: string;
  enable: string;
  name: string;
  next: string;
  noUsers: string;
  of: string;
  page: string;
  previous: string;
  role: string;
  search: string;
  searchPlaceholder: string;
  status: string;
  systemText: string;
  userFound: string;
  usersFound: string;
  username: string;
}

const en: UsersPageLabels = {
  actions: "Actions",
  active: "Active",
  allRoles: "All roles",
  created: "Created",
  disable: "Disable",
  disabled: "Disabled",
  email: "Email",
  enable: "Enable",
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
};

const zh: UsersPageLabels = {
  actions: "操作",
  active: "啟用",
  allRoles: "全部角色",
  created: "建立時間",
  disable: "停用",
  disabled: "停用",
  email: "Email",
  enable: "啟用",
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
};

export function getUsersPageLabels(lang: UiLang): UsersPageLabels {
  return lang === "en" ? en : zh;
}
