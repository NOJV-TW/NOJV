import { browser } from "$app/environment";
import { init, register, getLocaleFromNavigator } from "svelte-i18n";

export const SUPPORTED_LOCALES = ["en", "zh-TW"] as const;
export const DEFAULT_LOCALE = "zh-TW";

register("en", () => import("./en.json"));
register("zh-TW", () => import("./zh-TW.json"));

init({
  fallbackLocale: DEFAULT_LOCALE,
  initialLocale: browser ? getLocaleFromNavigator() : DEFAULT_LOCALE
});
