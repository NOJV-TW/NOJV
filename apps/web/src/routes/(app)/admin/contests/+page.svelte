<script lang="ts">
  import { Trophy } from "@lucide/svelte";

  import type { PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { data }: { data: PageData } = $props();

  function pillStatus(status: (typeof data.contests)[number]["status"]): string {
    if (status === "running") return "live";
    return status;
  }
</script>

<PageContainer class="animate-in animate-in-2 space-y-5">
  <div>
    <h1 class="text-title-lg font-semibold">{m.navigation_contests()}</h1>
    <p class="mt-1 text-body-sm text-muted-foreground">
      {m.admin_contentContestsDescription()}
    </p>
  </div>
  {#if data.contests.length === 0}
    <EmptyState icon={Trophy} title={m.admin_contentEmpty()} />
  {:else}
    <div class="grid gap-2">
      {#each data.contests as contest, index (contest.id)}
        <AssessmentRow
          href="/contests/{contest.id}"
          kind="contest"
          typeLabel={m.contestDetail_typeLabel()}
          context={contest.ownerDisplayName}
          title={contest.title}
          status={pillStatus(contest.status)}
          startsAt={contest.startsAt}
          endsAt={contest.endsAt}
          delay={index * 30}
        >
          {#snippet foot()}
            {m.admin_contentProblemCount({ count: contest.problemCount })} ·
            {m.admin_contentParticipantCount({ count: contest.participantCount })}
          {/snippet}
        </AssessmentRow>
      {/each}
    </div>
  {/if}
</PageContainer>
