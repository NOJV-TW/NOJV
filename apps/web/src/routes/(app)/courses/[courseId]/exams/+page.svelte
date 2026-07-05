<script lang="ts">
  import { page } from "$app/state";
  import Plus from "@lucide/svelte/icons/plus";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import ExamRow from "$lib/components/features/course/exam/ExamRow.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { exams, canCreate } = $derived(data);
  const courseId = $derived(page.params.courseId ?? "");
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
    <div class="animate-in animate-in-2 grid gap-2">
      {#each exams as exam, i (exam.id)}
        <ExamRow exam={{ ...exam, courseTitle: "" }} delay={i * 80} />
      {/each}
    </div>
  {/if}
</PageContainer>
