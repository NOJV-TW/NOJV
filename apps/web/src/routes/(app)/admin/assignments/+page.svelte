<script lang="ts">
  import { ClipboardList } from "@lucide/svelte";

  import type { PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { data }: { data: PageData } = $props();

  function pillStatus(status: (typeof data.assignments)[number]["status"]): string {
    if (status === "open") return "in_progress";
    if (status === "upcoming") return "not_started";
    return status;
  }
</script>

<PageContainer class="animate-in animate-in-2 space-y-5">
  <div>
    <h1 class="text-title-lg font-semibold">{m.navigation_assignments()}</h1>
    <p class="mt-1 text-body-sm text-muted-foreground">
      {m.admin_contentAssignmentsDescription()}
    </p>
  </div>
  {#if data.assignments.length === 0}
    <EmptyState icon={ClipboardList} title={m.admin_contentEmpty()} />
  {:else}
    <div class="grid gap-2">
      {#each data.assignments as assignment, index (assignment.id)}
        <AssessmentRow
          href="/assignments/{assignment.id}"
          kind="assignment"
          typeLabel={m.assignmentDetail_typeLabel()}
          context={`${assignment.courseTitle} · ${assignment.ownerDisplayName}`}
          title={assignment.title}
          status={pillStatus(assignment.status)}
          startsAt={assignment.opensAt}
          endsAt={assignment.closesAt}
          delay={index * 30}
        >
          {#snippet foot()}{m.admin_contentProblemCount({
              count: assignment.problemCount,
            })}{/snippet}
        </AssessmentRow>
      {/each}
    </div>
  {/if}
</PageContainer>
