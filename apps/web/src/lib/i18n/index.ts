import { browser } from "$app/environment";
import { init, register, getLocaleFromNavigator } from "svelte-i18n";

register("en", () => import("../../../messages/en.json"));
register("zh-TW", () => import("../../../messages/zh-TW.json"));

init({
  fallbackLocale: "zh-TW",
  initialLocale: browser ? getLocaleFromNavigator() : "zh-TW"
});
