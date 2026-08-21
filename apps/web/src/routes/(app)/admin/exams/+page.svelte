<script lang="ts">
  import { FileCheck } from "@lucide/svelte";

  import type { PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { data }: { data: PageData } = $props();

  function pillStatus(status: (typeof data.exams)[number]["status"]): string {
    if (status === "running") return "in_progress";
    if (status === "upcoming") return "scheduled";
    return status;
  }
</script>

<PageContainer class="animate-in animate-in-2 space-y-5">
  <div>
    <h1 class="text-title-lg font-semibold">{m.navigation_exams()}</h1>
    <p class="mt-1 text-body-sm text-muted-foreground">{m.admin_contentExamsDescription()}</p>
  </div>
  {#if data.exams.length === 0}
    <EmptyState icon={FileCheck} title={m.admin_contentEmpty()} />
  {:else}
    <div class="grid gap-2">
      {#each data.exams as exam, index (exam.id)}
        <AssessmentRow
          href="/exams/{exam.id}"
          kind="exam"
          typeLabel={m.examDetail_typeLabel()}
          context={`${exam.courseTitle} · ${exam.ownerDisplayName}`}
          title={exam.title}
          status={pillStatus(exam.status)}
          startsAt={exam.startsAt}
          endsAt={exam.endsAt}
          delay={index * 30}
        >
          {#snippet foot()}{m.admin_contentProblemCount({ count: exam.problemCount })}{/snippet}
        </AssessmentRow>
      {/each}
    </div>
  {/if}
</PageContainer>
