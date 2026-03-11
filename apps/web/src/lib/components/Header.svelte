<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";
  import UserAuthMenu from "./UserAuthMenu.svelte";

  const supportedLocales = ["en", "zh-TW"] as const;

  let currentLocale = $derived(($page.params as { locale?: string }).locale ?? "zh-TW");
  let user = $derived($page.data.user as { name: string; handle?: string } | null);
  let isLoggedIn = $derived(!!user);

  let navItems = $derived(
    isLoggedIn
      ? [
          { href: `/${currentLocale}/problems`, label: $t("navigation.problems") },
          { href: `/${currentLocale}/courses`, label: $t("navigation.courses") },
          { href: `/${currentLocale}/assignments`, label: $t("navigation.assignments") },
          { href: `/${currentLocale}/exams`, label: $t("navigation.exams") }
        ]
      : []
  );
</script>

<header
  class="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-[color:var(--color-border)] bg-[color:var(--color-panel)] px-5 py-3 backdrop-blur-sm sm:px-6"
>
  <div class="flex flex-wrap items-center gap-4">
    <a
      class="font-[family-name:var(--font-display)] text-xl font-bold"
      href="/{currentLocale}"
    >
      NOJV
    </a>

    {#if navItems.length > 0}
      <nav class="flex flex-wrap items-center gap-2 text-sm font-medium">
        {#each navItems as item (item.href)}
          <a
            class="rounded-full border border-[color:var(--color-border)] px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white/70"
            href={item.href}
          >
            {item.label}
          </a>
        {/each}
      </nav>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <div
        class="flex items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-white/60 p-1 text-sm"
      >
        {#each supportedLocales as entry (entry)}
          <a
            class="rounded-full px-3 py-1.5 {entry === currentLocale
              ? 'bg-[color:var(--color-accent)] text-white'
              : ''}"
            href="/{entry}"
          >
            {entry}
          </a>
        {/each}
      </div>
      <UserAuthMenu />
    </div>
  </div>
</header>
