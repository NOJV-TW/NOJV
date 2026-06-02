<script lang="ts">
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import { IconButton } from "$lib/components/primitives/ui/button/index.js";
  import { m } from "$lib/paraglide/messages.js";

  let isDark = $state(false);

  function toggle() {
    isDark = !isDark;

    document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("nojv-theme", isDark ? "dark" : "light");
    setTimeout(() => {
      document.documentElement.classList.remove("theme-transition");
    }, 200);
  }

  $effect(() => {
    isDark = document.documentElement.classList.contains("dark");
  });
</script>

<IconButton
  variant="ghost"
  size="lg"
  label={isDark ? m.theme_switchToLight() : m.theme_switchToDark()}
  title={isDark ? m.theme_switchToLight() : m.theme_switchToDark()}
  onclick={toggle}
>
  {#if isDark}
    <SunIcon aria-hidden="true" class="size-4" />
  {:else}
    <MoonIcon aria-hidden="true" class="size-4" />
  {/if}
</IconButton>
