<script lang="ts">
  import { page } from "$app/state";
  import { Plus } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import AssignmentCard from "$lib/components/features/course/assignment/AssignmentCard.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { assignments, canCreate } = $derived(data);
  const courseId = $derived(page.params.courseId ?? "");
</script>

<PageContainer class="space-y-6">
  {#if canCreate}
    <div class="animate-in animate-in-1 flex justify-end">
      <Button href={`/courses/${courseId}/assignments/new`}>
        <Plus aria-hidden="true" class="h-4 w-4" />
        {m.courseAssignments_createNew()}
      </Button>
    </div>
  {/if}

  {#if assignments.length === 0}
    <div
      class="animate-in animate-in-2 rounded-xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {m.courseAssignments_empty()}
    </div>
  {:else}
    <div class="animate-in animate-in-2 grid gap-2">
      {#each assignments as assignment, i (assignment.id)}
        <AssignmentCard
          assignment={{ ...assignment, courseId, courseTitle: "" }}
          delay={i * 60}
        />
      {/each}
    </div>
  {/if}
</PageContainer>
