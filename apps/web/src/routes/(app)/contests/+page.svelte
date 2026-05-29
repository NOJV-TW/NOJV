<script lang="ts">
  import { enhance } from "$app/forms";
  import { Plus, Trophy } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/primitives/ui/dialog/index.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import { Input } from "$lib/components/primitives/ui/input/index.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import ContestSection from "$lib/components/features/contest/ContestSection.svelte";
  import ContestPoster from "$lib/components/features/contest/ContestPoster.svelte";
  import ContestRowPast from "$lib/components/features/contest/ContestRowPast.svelte";
  import { contestStatusFor, durationMinutes } from "$lib/components/features/contest/format";

  let { data, form: actionData } = $props();

  let joinDialogOpen = $state(false);

  type Contest = (typeof data)["participable"][number];

  function decorate(c: Contest) {
    const status = contestStatusFor(c.startsAt, c.endsAt);
    return {
      raw: c,
      status,
      scoringLabel:
        c.scoringMode === "problem_count"
          ? m.contestsList_scoringProblemCount()
          : m.contestsList_scoringPointSum(),
      code: c.id,
      durationMin: durationMinutes(c.startsAt, c.endsAt)
    };
  }

  const all = $derived(
    [...data.participable, ...data.managed].map(decorate).sort((a, b) => {
      return new Date(b.raw.startsAt).getTime() - new Date(a.raw.startsAt).getTime();
    })
  );

  const live = $derived(all.filter((x) => x.status === "live"));
  const upcoming = $derived(
    [...all]
      .filter((x) => x.status === "upcoming")
      .sort(
        (a, b) =>
          new Date(a.raw.startsAt).getTime() - new Date(b.raw.startsAt).getTime()
      )
  );
  const past = $derived(all.filter((x) => x.status === "ended"));
</script>

<PageContainer>
  <div class="space-y-8 fade-up">
    <PageHeader
      eyebrow={m.contests_eyebrow()}
      title={m.contestsList_heroTitle()}
      description={m.contestsList_heroDescription()}
    >
      {#snippet icon()}
        <Trophy class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
      {/snippet}
    </PageHeader>

  <div class="flex flex-wrap items-center gap-3">
    {#if data.loggedIn}
      <Button variant="outline" type="button" onclick={() => (joinDialogOpen = true)}>
        {m.contestsList_joinByCode()}
      </Button>
      <Button href="/contests/new">
        <Plus class="h-4 w-4" />
        {m.contestsList_create()}
      </Button>
    {/if}
  </div>

  {#if live.length > 0}
    <ContestSection title={m.contestsList_sectionLiveTitle().toUpperCase()} subtitle={m.contestsList_sectionLiveSubtitle()} badge={m.contestsList_sectionLiveBadge()}>
      <div class="grid gap-4">
        {#each live as c, i (c.raw.id)}
          <ContestPoster
            href="/contests/{c.raw.id}"
            code={c.code}
            scoringLabel={c.scoringLabel}
            status={c.status}
            title={c.raw.title}
            summary={c.raw.summary}
            startsAt={c.raw.startsAt}
            endsAt={c.raw.endsAt}
            durationMin={c.durationMin}
            participants={c.raw.participantCount}
            delay={i * 80}
          />
        {/each}
      </div>
    </ContestSection>
  {/if}

  <ContestSection title={m.contestsList_sectionUpcomingTitle().toUpperCase()} subtitle={m.contestsList_sectionUpcomingSubtitle()}>
    {#if upcoming.length === 0}
      <div
        class="glass rounded-xl px-6 py-10 text-center text-body-sm text-muted-foreground"
      >
        {m.contestsList_sectionUpcomingEmpty()}
      </div>
    {:else}
      <div class="grid gap-4">
        {#each upcoming as c, i (c.raw.id)}
          <ContestPoster
            href="/contests/{c.raw.id}"
            code={c.code}
            scoringLabel={c.scoringLabel}
            status={c.status}
            title={c.raw.title}
            summary={c.raw.summary}
            startsAt={c.raw.startsAt}
            endsAt={c.raw.endsAt}
            durationMin={c.durationMin}
            participants={c.raw.participantCount}
            delay={i * 80}
          />
        {/each}
      </div>
    {/if}
  </ContestSection>

  {#if past.length > 0}
    <ContestSection title={m.contestsList_sectionHistoryTitle().toUpperCase()} subtitle={m.contestsList_sectionHistorySubtitle()}>
      <div class="grid gap-3">
        {#each past as c, i (c.raw.id)}
          <ContestRowPast
            href="/contests/{c.raw.id}"
            code={c.code}
            scoringLabel={c.scoringLabel}
            title={c.raw.title}
            startsAt={c.raw.startsAt}
            participants={c.raw.participantCount}
            delay={i * 60}
          />
        {/each}
      </div>
    </ContestSection>
  {/if}

  <Dialog.Root bind:open={joinDialogOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{m.contestsList_joinDialogTitle()}</Dialog.Title>
      </Dialog.Header>
      <form class="flex flex-col gap-4" method="POST" action="?/joinByCode" use:enhance>
        <!-- svelte-ignore a11y_autofocus -->
        <Input name="code" placeholder="spring-2026-final" autofocus />
        {#if actionData?.codeError}
          <p class="text-body-sm text-destructive">{actionData.codeError}</p>
        {/if}
        <div class="flex justify-end">
          <Button type="submit">{m.contestsList_joinSubmit()}</Button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>
  </div>
</PageContainer>
