<script lang="ts">
  import { page } from "$app/state";
  import { m } from "$lib/paraglide/messages.js";
  import { Bell, ChevronRight, Compass } from "@lucide/svelte";
  import { replayStudentTour } from "$lib/onboarding/student-tour";
  import NotificationPreferencesDialog from "$lib/components/features/account/NotificationPreferencesDialog.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let notificationsOpen = $state(false);

  const settingLinkClass =
    "group flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const settingChevronClass =
    "h-4 w-4 text-muted-foreground transition-transform duration-fast ease-out-soft group-hover:translate-x-0.5";
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg font-semibold">{m.navigation_settings()}</h1>
    {/snippet}

    <Card variant="surface" size="md">
      <section class="flex flex-col gap-4">
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
