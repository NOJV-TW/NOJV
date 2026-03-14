<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { page } from "$app/stores";
  import Header from "$lib/components/layout/Header.svelte";
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
    <section
      class="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm"
    >
      <h2
        class="font-[family-name:var(--font-display)] text-3xl leading-tight text-foreground"
      >
        {m.home_announcements()}
      </h2>

      {#if data.announcements.length === 0}
        <p class="mt-6 text-sm text-muted-foreground">
          {m.home_noAnnouncements()}
        </p>
      {:else}
        <div class="mt-6 space-y-3">
          {#each data.announcements as announcement (announcement.id)}
            <div
              class="rounded-2xl border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 backdrop-blur-sm"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    {#if announcement.pinned}
                      <span
                        class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary"
                      >
                        Pinned
                      </span>
                    {/if}
                    <h3 class="truncate text-sm font-semibold text-foreground">
                      {announcement.title}
                    </h3>
                  </div>
                  <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {announcement.content}
                  </p>
                </div>
                <time
                  class="shrink-0 text-xs text-muted-foreground"
                  datetime={new Date(announcement.createdAt).toISOString()}
                >
                  {new Date(announcement.createdAt).toLocaleDateString()}
                </time>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    {#if !user}
      <!-- Right column: Hero card (logged out) -->
      <section
        class="flex items-center justify-center animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_200ms_both] rounded-[2rem] border border-border bg-[color:var(--color-panel-strong)] px-10 py-14 text-center backdrop-blur-sm"
      >
        <div>
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground"
          >
            {m.hero_eyebrow()}
          </p>
          <h1
            class="mt-4 font-[family-name:var(--font-display)] text-5xl font-bold leading-tight text-foreground sm:text-6xl"
          >
            NOJV
          </h1>
          <p class="mt-4 max-w-md text-lg text-muted-foreground">
            {m.hero_subtitle()}
          </p>
          <a
            href="/signin"
            class="mt-8 inline-block rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
          >
            {m.auth_signIn()}
          </a>
        </div>
      </section>
    {:else}
      <!-- Right column: Upcoming Assessments (logged in) -->
      <section
        class="animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_200ms_both] rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm"
      >
        <h2
          class="font-[family-name:var(--font-display)] text-3xl leading-tight text-foreground"
        >
          {m.home_upcomingAssessments()}
        </h2>

        {#if data.assessments.length === 0}
          <p class="mt-6 text-sm text-muted-foreground">
            {m.home_noAssessments()}
          </p>
        {:else}
          <div class="mt-6 space-y-3">
            {#each data.assessments as assessment (assessment.slug)}
              {@const href = assessmentPath(assessment.courseSlug, assessment.slug)}
              <a
                href={href}
                class="block rounded-2xl border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 backdrop-blur-sm transition hover:-translate-y-0.5"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p
                      class="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground"
                    >
                      {assessment.courseTitle}
                    </p>
                    <h3 class="mt-1 text-sm font-semibold text-foreground">
                      {assessment.title}
                    </h3>
                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{m.assessment_opens()}: {new Date(assessment.opensAt).toLocaleDateString()}</span>
                      <span>{m.home_due()}: {new Date(assessment.dueAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      class="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider {assessment.windowStateColor}"
                    >
                      {assessment.windowState}
                    </span>
                    <span
                      class="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {m.home_assignment()}
                    </span>
                  </div>
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
  </main>
</div>
