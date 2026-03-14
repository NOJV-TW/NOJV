<script lang="ts">
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";

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

<button
  class="flex size-9 cursor-pointer items-center justify-center rounded-full border border-border transition hover:-translate-y-0.5 hover:bg-accent"
  onclick={toggle}
  title={isDark ? "Switch to light mode" : "Switch to dark mode"}
  type="button"
  aria-label="Toggle theme"
>
  {#if isDark}
    <SunIcon size={16} />
  {:else}
    <MoonIcon size={16} />
  {/if}
</button>
