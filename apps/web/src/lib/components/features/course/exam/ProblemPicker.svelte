<script lang="ts">
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { problemDomain } from "@nojv/application";

  import { m } from "$lib/paraglide/messages.js";
  import ProblemSelectDialog, {
    type CandidateProblem as PickerCandidate,
  } from "$lib/components/features/problem/ProblemSelectDialog.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { moveItem } from "$lib/utils/reorder";

  type CandidateProblem = problemDomain.ProblemPickerCandidate;
  type CandidateGroups = problemDomain.ProblemPickerGroups;

  interface Props {
    candidateProblems: CandidateGroups;
    error?: unknown;
    onProblemIdsChange?: (ids: string[]) => void;
    problemIds: string[];
    showSelected?: boolean;
  }

  let {
    candidateProblems,
    error,
    onProblemIdsChange,
    problemIds = $bindable(),
    showSelected = true,
  }: Props = $props();

  let pickerOpen = $state(false);
  let draggedId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);

  const selectedDetails = $derived.by(() => {
    const lookup = new Map<CandidateProblem["id"], CandidateProblem>(
      [...candidateProblems.publicProblems, ...candidateProblems.personalProblems].map(
        (problem) => [problem.id, problem],
      ),
    );
    return problemIds
      .map((id) => lookup.get(id))
      .filter((problem): problem is CandidateProblem => problem !== undefined);
  });

  const errorText = $derived(formatError(error));

  function setProblemIds(next: string[]) {
    problemIds = next;
    onProblemIdsChange?.(next);
  }

  function addSelectedProblems(problems: PickerCandidate[]) {
    const nextIds = problems
      .map((problem) => problem.id)
      .filter((id) => !problemIds.includes(id));
    if (nextIds.length > 0) setProblemIds([...problemIds, ...nextIds]);
  }

  function removeProblem(id: string) {
    setProblemIds(problemIds.filter((problemId) => problemId !== id));
  }

  function reorderProblem(sourceId: string, targetId: string) {
    const next = moveItem(
      problemIds,
      problemIds.indexOf(sourceId),
      problemIds.indexOf(targetId),
    );
    setProblemIds(next);
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
    const index = problemIds.indexOf(id);
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = index + delta;
    if (delta === 0 || index < 0 || target < 0 || target >= problemIds.length) return;
    event.preventDefault();
    setProblemIds(moveItem(problemIds, index, target));
  }

  function difficultyClass(difficulty: string): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    if (difficulty === "hard") return "text-destructive";
    return "text-muted-foreground";
  }

  function formatError(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ");
    if (typeof value === "object" && value !== null && "_errors" in value) {
      const errors = (value as { _errors?: unknown })._errors;
      if (Array.isArray(errors)) {
        return errors.filter((v) => typeof v === "string").join(", ");
      }
    }
    return null;
  }
</script>

<div class="flex justify-end">
  <Button type="button" variant="outline" size="sm" onclick={() => (pickerOpen = true)}>
    <Plus aria-hidden="true" class="size-4" />
    {m.problemPicker_addButton()}
  </Button>
</div>

{#if showSelected && selectedDetails.length > 0}
  <div class="mt-4">
    <div
      class="flex items-center justify-between px-1 pb-2 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground"
    >
      <span>{m.examCreate_selectedProblemsCount({ count: selectedDetails.length })}</span>
    </div>
    <div class="space-y-2">
      {#each selectedDetails as problem, index (problem.id)}
        <div
          role="listitem"
          class="flex items-center gap-4 rounded-md border bg-[color:var(--color-panel)] px-4 py-3 transition-colors hover:border-border-strong {dragOverId ===
          problem.id
            ? 'border-primary bg-primary/5'
            : 'border-border'}"
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
            <GripVertical aria-hidden="true" class="h-4 w-4" />
          </span>
          <span class="text-title-sm text-muted-foreground min-w-[20px] text-center">
            {index + 1}
          </span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-body-sm font-medium">{problem.title}</div>
            <div class="font-mono text-caption text-muted-foreground">
              {problem.displayId == null ? m.common_problemDraft() : `#${problem.displayId}`}
            </div>
          </div>
          <span
            class="text-micro font-semibold uppercase tracking-[0.08em] {difficultyClass(
              problem.difficulty,
            )}"
          >
            {problem.difficulty}
          </span>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-transparent hover:text-destructive"
            onclick={() => removeProblem(problem.id)}
            aria-label={m.examCreate_removeProblem()}
            title={m.examCreate_removeProblem()}
          >
            <Trash2 aria-hidden="true" class="size-3.5" />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if errorText}
  <p class="mt-2 text-xs text-destructive">{errorText}</p>
{/if}

<ProblemSelectDialog
  bind:open={pickerOpen}
  {candidateProblems}
  selectedIds={problemIds}
  onConfirm={addSelectedProblems}
/>
