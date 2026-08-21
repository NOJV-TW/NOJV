<script lang="ts" module>
  import type { examDomain, problemDomain } from "@nojv/application";

  export type ProblemsTabDetail = examDomain.ExamDetailPage;
  export type ProblemsLiveStatus = "draft" | "upcoming" | "running" | "ended";
  export type CandidateProblem = problemDomain.ProblemPickerCandidate;
  export type CandidateProblemGroups = problemDomain.ProblemPickerGroups;
</script>

<script lang="ts">
  import { beforeNavigate } from "$app/navigation";
  import { enhance } from "$app/forms";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Eye from "@lucide/svelte/icons/eye";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";
  import ProblemSelectDialog, {
    type CandidateProblem as PickerCandidate,
  } from "$lib/components/features/problem/ProblemSelectDialog.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css";
  import { moveItem } from "$lib/utils/reorder";
  import { m } from "$lib/paraglide/messages.js";
  import type { ActionData } from "../../../../../routes/(app)/exams/[examId]/$types";

  interface Props {
    detail: ProblemsTabDetail;
    liveStatus?: ProblemsLiveStatus;
    canEdit: boolean;
    canRejudge?: boolean;
    candidateProblems?: CandidateProblemGroups;
    form?: ActionData;
    class?: string;
  }

  let {
    detail,
    canEdit,
    canRejudge = false,
    candidateProblems = { personalProblems: [], publicProblems: [] },
    form,
    class: className,
  }: Props = $props();

  type EditableProblem = Pick<
    ProblemsTabDetail["problems"][number],
    "id" | "title" | "difficulty" | "displayId"
  >;

  let editProblems = $state<EditableProblem[]>([]);
  let pickerOpen = $state(false);
  let rejudgeProblemId = $state<string | null>(null);
  let draggedId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);

  $effect(() => {
    editProblems = detail.problems.map((problem) => ({
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      displayId: problem.displayId,
    }));
  });

  const ids = $derived(editProblems.map((problem) => problem.id));
  const hasChanges = $derived(
    ids.join("\0") !== detail.problems.map((problem) => problem.id).join("\0"),
  );

  beforeNavigate(({ cancel }) => {
    if (hasChanges && !confirm(m.admin_unsavedChangesMessage())) cancel();
  });

  function reorderProblem(sourceId: string, targetId: string) {
    editProblems = moveItem(
      editProblems,
      editProblems.findIndex((problem) => problem.id === sourceId),
      editProblems.findIndex((problem) => problem.id === targetId),
    );
  }

  function handleDragStart(event: DragEvent, id: string) {
    draggedId = id;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent, id: string) {
    if (!draggedId) return;
    event.preventDefault();
    dragOverId = draggedId === id ? null : id;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    const sourceId = draggedId ?? event.dataTransfer?.getData("text/plain");
    if (sourceId && sourceId !== targetId) reorderProblem(sourceId, targetId);
    draggedId = null;
    dragOverId = null;
  }

  function handleDragEnd() {
    draggedId = null;
    dragOverId = null;
  }

  function handleHandleKeydown(event: KeyboardEvent, id: string) {
    const index = ids.indexOf(id);
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = index + delta;
    if (delta === 0 || index < 0 || target < 0 || target >= ids.length) return;
    event.preventDefault();
    reorderProblem(id, ids[target]!);
  }

  function detach(id: string) {
    editProblems = editProblems.filter((problem) => problem.id !== id);
  }

  function addProblems(problems: PickerCandidate[]) {
    const selected = new Set(ids);
    editProblems = [
      ...editProblems,
      ...problems
        .filter((problem) => !selected.has(problem.id))
        .map((problem) => ({
          id: problem.id,
          title: problem.title,
          difficulty: problem.difficulty,
          displayId: problem.displayId,
        })),
    ];
  }

  function difficultyClass(d: string): string {
    if (d === "easy") return "text-success";
    if (d === "medium") return "text-warning";
    if (d === "hard") return "text-destructive";
    return "text-muted-foreground";
  }

  function closeRejudgeDialog(open: boolean) {
    if (!open) rejudgeProblemId = null;
  }
</script>

<section data-slot="exam-problems-tab" class={cn(className)}>
  <header class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="text-title font-medium">
        {m.examDetail_problemsEditHeading()}
      </h2>
      {#if !canEdit}
        <span class="text-caption text-muted-foreground">
          {m.examDetail_problemsEditFrozenHint()}
        </span>
      {/if}
    </div>
    {#if canEdit}
      <div class="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onclick={() => (pickerOpen = true)}>
          <Plus class="size-4" aria-hidden="true" />
          {m.problemPicker_addButton()}
        </Button>
        {#if hasChanges}
          <Button type="submit" form="exam-problems-form" size="sm" variant="default">
            <Save class="size-4" aria-hidden="true" />
            {m.examDetail_problemsEditSaveButton()}
          </Button>
        {/if}
      </div>
    {/if}
  </header>

  {#if form?.error}
    <div
      role="alert"
      class="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
    >
      {form.error}
    </div>
  {/if}

  {#if ids.length === 0}
    <div
      class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body-sm text-muted-foreground"
    >
      {m.examDetail_problemsEditEmptyHint()}
    </div>
  {:else}
    <form
      id="exam-problems-form"
      method="POST"
      action="?/updateProblems"
      use:enhance
      class="space-y-3"
    >
      <ul class="space-y-2.5">
        {#each editProblems as problem, index (problem.id)}
          <li
            class="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 {dragOverId ===
            problem.id
              ? 'border-primary bg-primary/5'
              : 'border-border-subtle'}"
            ondragover={(event) => handleDragOver(event, problem.id)}
            ondrop={(event) => handleDrop(event, problem.id)}
          >
            <span
              class="cursor-grab text-muted-foreground active:cursor-grabbing"
              draggable="true"
              role="button"
              tabindex="0"
              aria-label={m.common_dragToReorder()}
              ondragstart={(event) => handleDragStart(event, problem.id)}
              ondragend={handleDragEnd}
              onkeydown={(event) => handleHandleKeydown(event, problem.id)}
            >
              <GripVertical class="size-4" aria-hidden="true" />
            </span>
            <span
              class="min-w-[28px] text-center text-title-sm font-medium text-muted-foreground"
            >
              {String.fromCharCode(65 + index)}
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-semibold">{problem.title}</div>
              <div class="mt-1 flex items-center gap-2 text-caption text-muted-foreground">
                <span class={difficultyClass(problem.difficulty)}>
                  {problem.difficulty}
                </span>
                <span class="font-mono opacity-75"
                  >{problem.displayId == null
                    ? m.common_problemDraft()
                    : `#${problem.displayId}`}</span
                >
              </div>
            </div>

            {#if canEdit}
              <div class="flex items-center gap-1">
                {#if canRejudge}
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={m.rejudge_problem_admin_button()}
                    title={m.rejudge_problem_admin_button()}
                    class="hover:bg-transparent"
                    onclick={() => (rejudgeProblemId = problem.id)}
                  >
                    <RotateCcw class="size-4" aria-hidden="true" />
                  </Button>
                {/if}
                <Button
                  href={`/exams/${detail.id}/problems/${problem.id}`}
                  variant="ghost"
                  size="icon"
                  aria-label={m.problemDetail_previewProblem()}
                  title={m.problemDetail_previewProblem()}
                  class="hover:bg-transparent"
                >
                  <Eye class="size-4" aria-hidden="true" />
                </Button>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-transparent hover:text-destructive"
                  onclick={() => detach(problem.id)}
                  aria-label={m.examDetail_problemsEditDetachButton()}
                  title={m.examDetail_problemsEditDetachButton()}
                >
                  <Trash2 aria-hidden="true" class="size-4" />
                </button>
              </div>
            {:else}
              <div class="flex items-center gap-2">
                {#if canRejudge}
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={m.rejudge_problem_admin_button()}
                    title={m.rejudge_problem_admin_button()}
                    class="hover:bg-transparent"
                    onclick={() => (rejudgeProblemId = problem.id)}
                  >
                    <RotateCcw class="size-4" aria-hidden="true" />
                  </Button>
                {/if}
                <Button
                  href={`/exams/${detail.id}/problems/${problem.id}`}
                  variant="ghost"
                  size="icon"
                  aria-label={m.examDetail_problemPreview()}
                  title={m.examDetail_problemPreview()}
                  class="hover:bg-transparent"
                >
                  <Eye class="size-4" aria-hidden="true" />
                </Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#each ids as id (id)}
        <input type="hidden" name="problemIds" value={id} />
      {/each}
    </form>
  {/if}
</section>

{#if canEdit}
  <ProblemSelectDialog
    bind:open={pickerOpen}
    {candidateProblems}
    selectedIds={ids}
    onConfirm={addProblems}
  />
{/if}

{#if rejudgeProblemId}
  <RejudgeDialog
    problemId={rejudgeProblemId}
    open={true}
    scope={{ type: "exam", id: detail.id }}
    onOpenChange={closeRejudgeDialog}
  />
{/if}
