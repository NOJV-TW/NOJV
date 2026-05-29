<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { page } from "$app/state";
  import { Megaphone, Calendar, Pin } from "@lucide/svelte";
  import Header from "$lib/components/features/layout/Header.svelte";
  import Footer from "$lib/components/primitives/layout/Footer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import AnnouncementViewDialog from "$lib/components/features/announcement/AnnouncementViewDialog.svelte";
  import { assignmentPath } from "$lib/utils/coursework-path";
  import { formatDate } from "$lib/utils/datetime";

  let { data } = $props();

  let user = $derived(page.data.user);

  type AnnouncementRow = (typeof data.announcements)[number];

  let viewing = $state<AnnouncementRow | null>(null);
  let viewOpen = $state(false);

  function openView(announcement: AnnouncementRow) {
    viewing = announcement;
    viewOpen = true;
  }
</script>

<svelte:head>
  <title>NOJV</title>
  <meta name="description" content={m.home_productDescription()} />
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
  <Header />
  <main class="flex-1 pt-6">
  <div class="grid gap-8 lg:grid-cols-[1fr_1fr]">
    
    <Card
      variant="surface"
      size="lg"
      class="animate-[fade-up_700ms_var(--ease-out-soft)_both]"
    >
      <h2 class="text-title-lg leading-tight text-foreground">
        {m.home_announcements()}
      </h2>

      {#if data.announcements.length === 0}
        <EmptyState
          variant="minimal"
          icon={Megaphone}
          title={m.home_noAnnouncements()}
          description={m.home_announcementsEmptyDescription()}
        />
      {:else}
        <div class="mt-6 space-y-3">
          {#each data.announcements as announcement (announcement.id)}
            <button
              type="button"
              class="w-full cursor-pointer rounded-md border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 text-left backdrop-blur-sm transition-colors duration-fast ease-out-soft hover:bg-accent/40"
              onclick={() => openView(announcement)}
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <h3 class="flex items-center gap-1.5 text-body-sm font-semibold text-foreground">
                    {#if announcement.pinned}
                      <Pin
                        class="size-3.5 shrink-0 text-warning"
                        aria-label={m.common_pinned()}
                      />
                    {/if}
                    <span class="truncate">{announcement.title}</span>
                  </h3>
                  <p class="mt-1 line-clamp-2 text-body-sm text-muted-foreground">
                    {announcement.content}
                  </p>
                </div>
                <time
                  class="shrink-0 text-caption text-muted-foreground tabular-nums"
                  datetime={announcement.createdAt}
                >
                  {formatDate(announcement.createdAt)}
                </time>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </Card>

    {#if !user}
      
      <Card
        variant="strong"
        size="hero"
        class="flex items-center justify-center text-center animate-[fade-up_700ms_var(--ease-out-soft)_200ms_both]"
      >
        <div>
          <p class="text-caption font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {m.hero_eyebrow()}
          </p>
          <h1
            class="mt-4 text-display font-bold leading-tight text-foreground sm:text-display-lg"
          >
            NOJV
          </h1>
          <p class="mt-4 max-w-md text-body-lg text-muted-foreground">
            {m.hero_subtitle()}
          </p>
          <div class="mt-8">
            <Button href="/signin" size="lg">{m.auth_signIn()}</Button>
          </div>
        </div>
      </Card>
    {:else}
      
      <Card
        variant="surface"
        size="lg"
        class="animate-[fade-up_700ms_var(--ease-out-soft)_200ms_both]"
      >
        <h2 class="text-title-lg leading-tight text-foreground">
          {m.home_upcomingAssessments()}
        </h2>

        {#if data.assignments.length === 0}
          <EmptyState
            variant="minimal"
            icon={Calendar}
            title={m.home_noAssessments()}
            description={m.home_assessmentsEmptyDescription()}
          />
        {:else}
          <div class="mt-6 space-y-3">
            {#each data.assignments as assignment (assignment.id)}
              {@const href = assignmentPath(assignment.id)}
              <a
                {href}
                class="block rounded-md border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 backdrop-blur-sm transition-transform duration-fast ease-out-soft hover:-translate-y-0.5"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-caption font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      {assignment.courseTitle}
                    </p>
                    <h3 class="mt-1 text-body-sm font-semibold text-foreground">
                      {assignment.title}
                    </h3>
                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground tabular-nums">
                      <span>{m.assessment_opens()}: {formatDate(assignment.opensAt)}</span>
                      <span>{m.home_due()}: {formatDate(assignment.dueAt)}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="info" size="xs">
                      {assignment.windowState}
                    </Badge>
                    <Badge variant="muted" size="xs">
                      {m.home_assignment()}
                    </Badge>
                  </div>
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {/if}
  </div>
  </main>
  <Footer />
</div>

<AnnouncementViewDialog bind:open={viewOpen} announcement={viewing} />
