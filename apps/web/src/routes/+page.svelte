<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { page } from "$app/stores";
  import { Megaphone, Calendar } from "@lucide/svelte";
  import Header from "$lib/components/layout/Header.svelte";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { assessmentPath } from "$lib/types";

  let { data } = $props();

  let user = $derived($page.data.user);
</script>

<svelte:head>
  <title>NOJV</title>
  <meta name="description" content={m.home_productDescription()} />
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
  <Header />
  <main class="flex-1 pt-6">
  <div class="grid gap-8 lg:grid-cols-[1fr_1fr]">
    <!-- Left column: Announcements -->
    <Card
      variant="surface"
      size="lg"
      class="animate-[fade-up_700ms_var(--ease-out-soft)_both]"
    >
      <h2 class="font-display text-title-lg leading-tight text-foreground">
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
            <div
              class="rounded-md border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 backdrop-blur-sm"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    {#if announcement.pinned}
                      <Badge variant="warning" size="xs">{m.common_pinned()}</Badge>
                    {/if}
                    <h3 class="truncate text-body-sm font-semibold text-foreground">
                      {announcement.title}
                    </h3>
                  </div>
                  <p class="mt-1 line-clamp-2 text-body-sm text-muted-foreground">
                    {announcement.content}
                  </p>
                </div>
                <time
                  class="shrink-0 text-caption text-muted-foreground tabular-nums"
                  datetime={new Date(announcement.createdAt).toISOString()}
                >
                  {new Date(announcement.createdAt).toLocaleDateString()}
                </time>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </Card>

    {#if !user}
      <!-- Right column: Hero card (logged out) -->
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
            class="mt-4 font-display text-display font-bold leading-tight text-foreground sm:text-display-lg"
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
      <!-- Right column: Upcoming Assessments (logged in) -->
      <Card
        variant="surface"
        size="lg"
        class="animate-[fade-up_700ms_var(--ease-out-soft)_200ms_both]"
      >
        <h2 class="font-display text-title-lg leading-tight text-foreground">
          {m.home_upcomingAssessments()}
        </h2>

        {#if data.assessments.length === 0}
          <EmptyState
            variant="minimal"
            icon={Calendar}
            title={m.home_noAssessments()}
            description={m.home_assessmentsEmptyDescription()}
          />
        {:else}
          <div class="mt-6 space-y-3">
            {#each data.assessments as assessment (assessment.slug)}
              {@const href = assessmentPath(assessment.courseSlug, assessment.slug)}
              <a
                {href}
                class="block rounded-md border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 backdrop-blur-sm transition-transform duration-fast ease-out-soft hover:-translate-y-0.5"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-caption font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      {assessment.courseTitle}
                    </p>
                    <h3 class="mt-1 text-body-sm font-semibold text-foreground">
                      {assessment.title}
                    </h3>
                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground tabular-nums">
                      <span>{m.assessment_opens()}: {new Date(assessment.opensAt).toLocaleDateString()}</span>
                      <span>{m.home_due()}: {new Date(assessment.dueAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="info" size="xs">
                      {assessment.windowState}
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
</div>
