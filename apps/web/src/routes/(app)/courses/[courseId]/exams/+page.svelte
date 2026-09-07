<script lang="ts">
  import { page } from "$app/state";
  import Plus from "@lucide/svelte/icons/plus";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import ExamRow from "$lib/components/features/course/exam/ExamRow.svelte";
  import AssessmentGroupHeading from "$lib/components/features/coursework/AssessmentGroupHeading.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { exams, canCreate } = $derived(data);
  const courseId = $derived(page.params.courseId ?? "");

  const groups = $derived(
    (
      [
        {
          key: "running",
          label: m.examsTop_filterRunning(),
          items: exams.filter((e) => e.status === "running"),
        },
        {
          key: "upcoming",
          label: m.examsTop_filterUpcoming(),
          items: exams.filter((e) => e.status === "upcoming" || e.status === "draft"),
        },
        {
          key: "ended",
          label: m.examsTop_filterEnded(),
          items: exams.filter((e) => e.status === "ended"),
        },
      ] as const
    ).filter((g) => g.items.length > 0),
  );
</script>

<PageContainer class="space-y-6">
  {#if canCreate}
    <div class="animate-in animate-in-1 flex justify-end">
      <Button href={`/courses/${courseId}/exams/new`}>
        <Plus aria-hidden="true" class="h-4 w-4" />
        {m.examsList_createNew()}
      </Button>
    </div>
  {/if}

  {#if exams.length === 0}
    <div
      class="animate-in animate-in-2 rounded-xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {m.examsList_empty()}
    </div>
  {:else}
    <div class="animate-in animate-in-2 space-y-8">
      {#each groups as g (g.key)}
        <section>
          <AssessmentGroupHeading label={g.label} status={g.key} count={g.items.length} />
          <div class="grid gap-2">
            {#each g.items as exam, i (exam.id)}
              <ExamRow
                exam={{ ...exam, courseTitle: "" }}
                showStatusIcon={false}
                delay={i * 80}
              />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</PageContainer>
