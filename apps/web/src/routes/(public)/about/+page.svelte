<script lang="ts">
  import { Mail, MessageSquare, Star } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Button } from "$lib/components/primitives/ui/button";
  import GithubMark from "$lib/components/primitives/layout/GithubMark.svelte";

  let { data } = $props();

  const roleByDevId = {
    a: () => m.about_devARole(),
    b: () => m.about_devBRole(),
    c: () => m.about_devCRole(),
  };

  let issuesUrl = $derived(`${data.repoUrl.replace(/\/$/, "")}/issues/new`);
</script>

<svelte:head>
  <title>{m.about_heroTitle()} · NOJV</title>
  <meta name="description" content={m.about_heroSubtitle()} />
</svelte:head>

<div class="space-y-16 pt-4">
  <section class="text-center animate-[fade-up_700ms_var(--ease-out-soft)_both]">
    <p class="text-caption font-semibold uppercase tracking-[0.24em] text-muted-foreground">
      {m.hero_eyebrow()}
    </p>
    <h1 class="mt-4 text-display font-bold leading-tight text-foreground sm:text-display-lg">
      {m.about_heroTitle()}
    </h1>
    <p class="mx-auto mt-5 max-w-2xl text-body-lg text-muted-foreground">
      {m.about_heroSubtitle()}
    </p>
    <div class="mt-8 flex justify-center">
      <Button href={data.repoUrl} size="lg" target="_blank" rel="noreferrer noopener">
        <GithubMark class="size-4" />
        {m.about_viewOnGithub()}
      </Button>
    </div>
  </section>

  <section class="animate-[fade-up_700ms_var(--ease-out-soft)_120ms_both]">
    <div class="mb-8 text-center">
      <h2 class="text-title-lg font-bold text-foreground">{m.about_teamTitle()}</h2>
      <p class="mt-2 text-body-sm text-muted-foreground">{m.about_teamSubtitle()}</p>
    </div>

    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.developers as dev (dev.id)}
        <Card variant="surface" size="lg" class="text-center">
          <img
            src={`https://github.com/${dev.github}.png`}
            alt={dev.name}
            loading="lazy"
            class="mx-auto size-20 rounded-full border border-border bg-[color:var(--color-panel-strong)] object-cover"
            referrerpolicy="no-referrer"
          />
          <div class="mt-4">
            <h3 class="text-title-sm font-semibold text-foreground">{dev.name}</h3>
            <p class="mt-1 text-body-sm text-muted-foreground">{roleByDevId[dev.id]()}</p>
          </div>
          <div class="mt-4 flex justify-center">
            <Button
              href={`https://github.com/${dev.github}`}
              target="_blank"
              rel="noreferrer noopener"
              variant="outline"
              size="sm"
            >
              <GithubMark class="size-3.5" />
              @{dev.github}
            </Button>
          </div>
        </Card>
      {/each}
    </div>
  </section>

  <section class="animate-[fade-up_700ms_var(--ease-out-soft)_240ms_both]">
    <Card variant="strong" size="hero" class="text-center">
      <h2 class="text-title-lg font-bold text-foreground">{m.about_openSourceTitle()}</h2>
      <p class="mx-auto mt-3 max-w-2xl text-body-sm text-muted-foreground">
        {m.about_openSourceBody()}
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-3">
        <Button href={data.repoUrl} variant="outline" target="_blank" rel="noreferrer noopener">
          <Star aria-hidden="true" class="size-4" />
          {m.about_starOnGithub()}
        </Button>
        <Button href={issuesUrl} variant="outline" target="_blank" rel="noreferrer noopener">
          <MessageSquare aria-hidden="true" class="size-4" />
          {m.about_openIssue()}
        </Button>
      </div>
    </Card>
  </section>

  <section class="animate-[fade-up_700ms_var(--ease-out-soft)_360ms_both]">
    <Card variant="surface" size="lg" class="text-center">
      <h2 class="text-title-lg font-bold text-foreground">{m.about_contactTitle()}</h2>
      <p class="mx-auto mt-3 max-w-2xl text-body-sm text-muted-foreground">
        {m.about_contactBody()}
      </p>
      <p class="mx-auto mt-2 max-w-2xl text-body-sm text-muted-foreground">
        {m.about_contactDiscord()}
      </p>
      <div class="mt-5 flex justify-center">
        <Button href={`mailto:${data.contactEmail}`} variant="outline">
          <Mail aria-hidden="true" class="size-4" />
          {m.about_emailUs()}
        </Button>
      </div>
    </Card>
  </section>
</div>
