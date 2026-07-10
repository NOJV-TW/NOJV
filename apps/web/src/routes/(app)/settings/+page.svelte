<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale, locales, setLocale } from "$lib/paraglide/runtime.js";
  import { Bell, ChevronRight, Compass, Monitor, Moon, Sun } from "@lucide/svelte";
  import { replayStudentTour } from "$lib/onboarding/student-tour";
  import {
    persistThemeMode,
    readThemeMode,
    resolveIsDark,
    type ThemeMode,
  } from "$lib/stores/theme";
  import NotificationPreferencesDialog from "$lib/components/features/account/NotificationPreferencesDialog.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let notificationsOpen = $state(false);

  const localeLabels: Record<string, string> = { en: "English", "zh-TW": "中文" };
  const currentLocale = getLocale();

  let themeMode = $state<ThemeMode>("system");
  $effect(() => {
    themeMode = readThemeMode();
  });

  function setTheme(next: ThemeMode) {
    themeMode = next;
    persistThemeMode(next);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.add("theme-transition");
    document.documentElement.classList.toggle("dark", resolveIsDark(next, prefersDark));
    setTimeout(() => document.documentElement.classList.remove("theme-transition"), 200);
  }

  const themeOptions: { mode: ThemeMode; label: () => string; icon: typeof Monitor }[] = [
    { mode: "system", label: m.theme_modeSystem, icon: Monitor },
    { mode: "light", label: m.theme_modeLight, icon: Sun },
    { mode: "dark", label: m.theme_modeDark, icon: Moon },
  ];

  const settingLinkClass =
    "group flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const settingChevronClass =
    "h-4 w-4 text-muted-foreground transition-transform duration-fast ease-out-soft group-hover:translate-x-0.5";
  const segmentClass =
    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const segmentActive = "border-primary bg-primary text-primary-foreground";
  const segmentIdle = "border-border hover:bg-accent";
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg font-semibold">{m.navigation_settings()}</h1>
    {/snippet}

    <Card variant="surface" size="md">
      <section class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-title-sm">{m.settings_interfaceTitle()}</h2>
          <p class="text-body-sm text-muted-foreground">{m.settings_interfaceHint()}</p>
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-4">
            <span class="text-body-sm">{m.settings_language()}</span>
            <div class="flex gap-1.5" role="group" aria-label={m.settings_language()}>
              {#each locales as entry (entry)}
                <button
                  type="button"
                  class="{segmentClass} {currentLocale === entry ? segmentActive : segmentIdle}"
                  aria-pressed={currentLocale === entry}
                  onclick={() => setLocale(entry)}
                >
                  {localeLabels[entry] ?? entry}
                </button>
              {/each}
            </div>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-body-sm">{m.settings_theme()}</span>
            <div class="flex gap-1.5" role="group" aria-label={m.settings_theme()}>
              {#each themeOptions as opt (opt.mode)}
                <button
                  type="button"
                  class="{segmentClass} {themeMode === opt.mode ? segmentActive : segmentIdle}"
                  aria-pressed={themeMode === opt.mode}
                  onclick={() => setTheme(opt.mode)}
                >
                  <opt.icon aria-hidden="true" class="h-3.5 w-3.5" />
                  {opt.label()}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-title-sm">{m.account_notifications_title()}</h2>
          <p class="text-body-sm text-muted-foreground">{m.account_notifications_hint()}</p>
        </div>
        <button
          type="button"
          class={settingLinkClass}
          onclick={() => (notificationsOpen = true)}
        >
          <span class="flex items-center gap-2.5">
            <Bell aria-hidden="true" class="h-4 w-4 text-muted-foreground" />
            {m.account_notifications_manage()}
          </span>
          <ChevronRight aria-hidden="true" class={settingChevronClass} />
        </button>
      </section>

      {#if data.platformRole === "student"}
        <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <div class="flex flex-col gap-1">
            <h2 class="text-title-sm">{m.account_tourTitle()}</h2>
            <p class="text-body-sm text-muted-foreground">{m.account_tourHint()}</p>
          </div>
          <button
            type="button"
            class="{settingLinkClass} w-full text-left"
            onclick={() => {
              const sessionUser = page.data.user;
              if (sessionUser) replayStudentTour(sessionUser.id);
            }}
          >
            <span class="flex items-center gap-2.5">
              <Compass aria-hidden="true" class="h-4 w-4 text-muted-foreground" />
              {m.account_tourReplay()}
            </span>
            <ChevronRight aria-hidden="true" class={settingChevronClass} />
          </button>
        </section>
      {/if}
    </Card>
  </Section>
</PageContainer>

<NotificationPreferencesDialog bind:open={notificationsOpen} data={data.notificationForm} />
