<script lang="ts" module>
  import type { courseDomain, problemDomain } from "@nojv/application";

  export type ProblemsTabProblem = courseDomain.AssignmentDetailProblem;
  export type CandidateProblem = problemDomain.ProblemPickerCandidate;
  export type CandidateProblemGroups = problemDomain.ProblemPickerGroups;
</script>

<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Eye from "@lucide/svelte/icons/eye";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { problemLetter } from "@nojv/core";

  import { m } from "$lib/paraglide/messages.js";
  import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";
  import ProblemSelectDialog, {
    type CandidateProblem as PickerCandidate,
  } from "$lib/components/features/problem/ProblemSelectDialog.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css";
  import { moveItem } from "$lib/utils/reorder";

  interface Props {
    problems: ProblemsTabProblem[];
    assignmentId: string;
    canEdit?: boolean;
    canRejudge?: boolean;
    candidateProblems?: CandidateProblemGroups;
    class?: string;
  }

  let {
    problems,
    assignmentId,
    canEdit = false,
    canRejudge = false,
    candidateProblems = { personalProblems: [], publicProblems: [] },
    class: className,
  }: Props = $props();

  function difficultyClass(difficulty: "easy" | "medium" | "hard"): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    return "text-destructive";
  }

  type EditRow = { problemId: string; title: string; letter: string };

  let editRows = $state<EditRow[]>([]);
  let pickerOpen = $state(false);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);
  let rejudgeProblemId = $state<string | null>(null);
  let draggedProblemId = $state<string | null>(null);
  let dragOverProblemId = $state<string | null>(null);

  function seedRows(source: ProblemsTabProblem[]) {
    editRows = source.map((p) => ({
      problemId: p.problemId,
      title: p.title,
      letter: p.letter,
    }));
  }

  $effect(() => {
    seedRows(problems);
  });

  function attachProblems(candidates: PickerCandidate[]) {
    editRows = [
      ...editRows,
      ...candidates.map((candidate, index) => ({
        problemId: candidate.id,
        title: candidate.title,
        letter: problemLetter(editRows.length + index + 1),
      })),
    ];
  }

  function detach(problemId: string) {
    editRows = editRows
      .filter((r) => r.problemId !== problemId)
      .map((r, i) => ({ ...r, letter: problemLetter(i + 1) }));
  }

  function reorderEditRow(sourceId: string, targetId: string) {
    editRows = moveItem(
      editRows,
      editRows.findIndex((r) => r.problemId === sourceId),
      editRows.findIndex((r) => r.problemId === targetId),
    ).map((r, idx) => ({ ...r, letter: problemLetter(idx + 1) }));
  }

  function handleDragStart(event: DragEvent, problemId: string) {
    draggedProblemId = problemId;
    event.dataTransfer?.setData("text/plain", problemId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent, problemId: string) {
    if (!draggedProblemId) return;
    event.preventDefault();
    dragOverProblemId = draggedProblemId === problemId ? null : problemId;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    const sourceId = draggedProblemId ?? event.dataTransfer?.getData("text/plain");
    if (sourceId && sourceId !== targetId) reorderEditRow(sourceId, targetId);
    draggedProblemId = null;
    dragOverProblemId = null;
  }

  function handleDragEnd() {
    draggedProblemId = null;
    dragOverProblemId = null;
  }

  function handleHandleKeydown(event: KeyboardEvent, problemId: string) {
    const index = editRows.findIndex((r) => r.problemId === problemId);
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = index + delta;
    if (delta === 0 || index < 0 || target < 0 || target >= editRows.length) return;
    event.preventDefault();
    reorderEditRow(problemId, editRows[target]!.problemId);
  }

  async function savePayload() {
    saving = true;
    errorMsg = null;
    const payload = {
      problemIds: editRows.map((r) => r.problemId),
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    const res = await fetch(`?/updateProblems`, { method: "POST", body: fd });
    saving = false;
    if (!res.ok) {
      errorMsg = `Save failed (${res.status})`;
      return;
    }
    await invalidateAll();
  }

  function closeRejudgeDialog(open: boolean) {
    if (!open) rejudgeProblemId = null;
  }
</script>

<section data-slot="assignment-problems-tab" class={cn("space-y-3", className)}>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="text-title font-medium leading-tight">
        {#if canEdit}
          {m.assignmentDetail_problemsEditHeading()}
        {:else}
          {m.assignmentDetail_teacherProblemsHeading()}
        {/if}
      </h2>
      {#if !canEdit}
        <span class="text-caption text-muted-foreground">
          {m.assignmentDetail_teacherProblemsHint()}
        </span>
      {/if}
    </div>
    {#if canEdit}
      <div class="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onclick={() => (pickerOpen = true)}>
          <Plus class="size-4" aria-hidden="true" />
          {m.problemPicker_addButton()}
        </Button>
        {#if editRows.length > 0}
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={saving}
            onclick={savePayload}
          >
            <Save class="size-4" aria-hidden="true" />
            {m.assignmentDetail_problemsEditSaveButton()}
          </Button>
        {/if}
      </div>
    {/if}
  </div>

  {#if !canEdit}
    <div class="grid gap-3">
      {#each problems as problem (problem.problemId)}
        <div
          class="group grid grid-cols-[auto_1fr_auto] items-center gap-5 rounded-md border border-border-subtle bg-[color:var(--color-panel)] px-5 py-4 transition-[transform,border-color,box-shadow] duration-fast ease-out-soft hover:translate-x-[2px] hover:border-border-strong hover:shadow-rest {canRejudge
            ? 'sm:grid-cols-[auto_1fr_auto_auto]'
            : ''}"
        >
          <a
            href={`/assignments/${assignmentId}/problems/${problem.problemId}`}
            class="contents no-underline"
          >
            <div
              class="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-title-sm font-medium text-muted-foreground"
            >
              {problem.letter}
            </div>
            <div class="min-w-0">
              <h4 class="truncate text-body-lg font-semibold text-foreground">
                {problem.title}
              </h4>
              <div
                class="mt-1 flex flex-wrap items-center gap-3 text-caption text-muted-foreground"
              >
                <span
                  class={cn(
                    "font-semibold uppercase tracking-[0.08em]",
                    difficultyClass(problem.difficulty),
                  )}
                >
                  {problem.difficulty}
                </span>
                <span>{problem.points} pts</span>
                <span class="font-mono opacity-75">{problem.problemId}</span>
              </div>
            </div>
            <div
              class="text-right text-caption text-muted-foreground tabular-nums leading-snug"
            >
              <span class="block text-title-sm font-medium text-foreground">—</span>
              {m.assignmentDetail_teacherProblemsClassPending()}
            </div>
          </a>
          {#if canRejudge}
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={m.rejudge_problem_admin_button()}
              title={m.rejudge_problem_admin_button()}
              class="hover:bg-transparent"
              onclick={() => (rejudgeProblemId = problem.problemId)}
            >
              <RotateCcw class="size-4" aria-hidden="true" />
            </Button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    {#if errorMsg}
      <p
        class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
      >
        {errorMsg}
      </p>
    {/if}

    {#if editRows.length === 0}
      <p
        class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-6 py-10 text-center text-body-sm text-muted-foreground"
      >
        {m.assignmentDetail_problemsEditEmptyHint()}
      </p>
    {:else}
      <div class="grid gap-2">
        {#each editRows as row (row.problemId)}
          <div
            role="listitem"
            class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-md border bg-[color:var(--color-panel)] px-4 py-3 {dragOverProblemId ===
            row.problemId
              ? 'border-primary bg-primary/5'
              : 'border-border'}"
            ondragover={(event) => handleDragOver(event, row.problemId)}
            ondrop={(event) => handleDrop(event, row.problemId)}
          >
            <div class="flex items-center gap-2">
              <span
                class="cursor-grab text-muted-foreground active:cursor-grabbing"
                draggable="true"
                role="button"
                tabindex="0"
                aria-label={m.common_dragToReorder()}
                ondragstart={(event) => handleDragStart(event, row.problemId)}
                ondragend={handleDragEnd}
                onkeydown={(event) => handleHandleKeydown(event, row.problemId)}
              >
                <GripVertical class="size-4" aria-hidden="true" />
              </span>
              <div
                class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-body-lg font-medium text-muted-foreground"
              >
                {row.letter}
              </div>
            </div>
            <div class="min-w-0">
              <div class="truncate text-body-sm font-semibold">{row.title}</div>
              <div class="font-mono text-caption text-muted-foreground">{row.problemId}</div>
            </div>
            <div class="flex items-center gap-1">
              {#if canRejudge}
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={m.rejudge_problem_admin_button()}
                  title={m.rejudge_problem_admin_button()}
                  class="hover:bg-transparent"
                  onclick={() => (rejudgeProblemId = row.problemId)}
                >
                  <RotateCcw class="size-4" aria-hidden="true" />
                </Button>
              {/if}
              <Button
                href={`/assignments/${assignmentId}/problems/${row.problemId}`}
                variant="ghost"
                size="icon"
                aria-label={m.problemDetail_previewProblem()}
                title={m.problemDetail_previewProblem()}
                class="hover:bg-transparent"
              >
                <Eye class="size-4" aria-hidden="true" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="hover:bg-transparent"
              type="button"
              aria-label={m.assignmentDetail_problemsEditDetachButton()}
              title={m.assignmentDetail_problemsEditDetachButton()}
              onclick={() => detach(row.problemId)}
            >
              <Trash2 class="size-4" aria-hidden="true" />
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

{#if canEdit}
  <ProblemSelectDialog
    bind:open={pickerOpen}
    {candidateProblems}
    selectedIds={editRows.map((row) => row.problemId)}
    onConfirm={attachProblems}
  />
{/if}

{#if rejudgeProblemId}
  <RejudgeDialog
    problemId={rejudgeProblemId}
    open={true}
    scope={{ type: "assignment", id: assignmentId }}
    onOpenChange={closeRejudgeDialog}
  />
{/if}
