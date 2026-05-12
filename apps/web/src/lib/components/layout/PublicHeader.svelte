<script lang="ts">
  import { getLocale, setLocale, locales } from "$lib/paraglide/runtime.js";
  import { cn } from "$lib/utils.js";
  import ThemeToggle from "./ThemeToggle.svelte";

  let currentLocale = $derived(getLocale());
</script>

<header
  class="sticky top-6 z-[var(--z-sticky)] rounded-xl border border-border bg-[color:var(--color-panel)]/85 px-5 py-3 shadow-rest backdrop-blur-md animate-[fade-up_700ms_var(--ease-out-soft)_both] sm:px-6"
>
  <div class="flex flex-wrap items-center gap-6">
    <a
      class="text-title-sm font-bold tracking-tight transition-colors duration-fast ease-out-soft hover:text-primary"
      href="/"
    >
      NOJV
    </a>

    <div class="ml-auto flex items-center gap-2">
      <div
        class="hidden items-center gap-1 rounded-full border border-border-subtle bg-[color:var(--color-panel-strong)] p-1 text-caption sm:flex"
      >
        {#each locales as entry (entry)}
          <button
            class={cn(
              "rounded-full px-2.5 py-1 transition-colors duration-fast ease-out-soft",
              entry === currentLocale
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onclick={() => setLocale(entry)}
            type="button"
          >
            {entry}
          </button>
        {/each}
      </div>
      <ThemeToggle />
    </div>
  </div>
</header>
