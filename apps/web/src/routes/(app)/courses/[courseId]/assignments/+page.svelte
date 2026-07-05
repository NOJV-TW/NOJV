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

  const groups = $derived(
    [
      {
        key: "open",
        label: m.assignmentsList_tabOpen(),
        items: assignments.filter((a) => a.status === "open"),
      },
      {
        key: "upcoming",
        label: m.assignmentsList_tabUpcoming(),
        items: assignments.filter((a) => a.status === "upcoming" || a.status === "draft"),
      },
      {
        key: "closed",
        label: m.assignmentsList_tabClosed(),
        items: assignments.filter((a) => a.status === "closed"),
      },
    ].filter((g) => g.items.length > 0),
  );
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
    <div class="animate-in animate-in-2 space-y-8">
      {#each groups as g (g.key)}
        <section>
          <div class="mb-4 flex items-end gap-3">
            <span class="text-body font-semibold">{g.label}</span>
            <span class="text-caption text-muted-foreground tabular-nums">{g.items.length}</span
            >
            <div class="ml-1 flex-1 border-t border-border-subtle"></div>
          </div>
          <div class="grid gap-2">
            {#each g.items as assignment, i (assignment.id)}
              <AssignmentCard
                assignment={{ ...assignment, courseId, courseTitle: "" }}
                delay={i * 60}
              />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</PageContainer>
