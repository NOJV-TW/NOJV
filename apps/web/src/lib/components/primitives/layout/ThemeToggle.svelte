<script lang="ts">
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import { IconButton } from "$lib/components/primitives/ui/button/index.js";
  import { m } from "$lib/paraglide/messages.js";
  import {
    nextThemeMode,
    persistThemeMode,
    readThemeMode,
    resolveIsDark,
    type ThemeMode
  } from "$lib/stores/theme";

  let mode = $state<ThemeMode>("system");

  function applyResolved(next: ThemeMode, animate: boolean) {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = resolveIsDark(next, prefersDark);
    if (animate) document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", isDark);
    if (animate) {
      setTimeout(() => document.documentElement.classList.remove("theme-transition"), 200);
    }
  }

  function cycle() {
    mode = nextThemeMode(mode);
    persistThemeMode(mode);
    applyResolved(mode, true);
  }

  $effect(() => {
    mode = readThemeMode();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode === "system") applyResolved("system", true);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  let label = $derived(
    mode === "system"
      ? m.theme_modeSystem()
      : mode === "dark"
        ? m.theme_modeDark()
        : m.theme_modeLight()
  );
</script>

<IconButton variant="ghost" size="sm" {label} title={label} onclick={cycle}>
  {#if mode === "system"}
    <MonitorIcon aria-hidden="true" class="size-4" />
  {:else if mode === "dark"}
    <MoonIcon aria-hidden="true" class="size-4" />
  {:else}
    <SunIcon aria-hidden="true" class="size-4" />
  {/if}
</IconButton>
