<script lang="ts" module>
  import type { courseDomain, problemDomain } from "@nojv/application";

  export type ProblemsTabProblem = courseDomain.AssignmentDetailProblem;
  export type CandidateProblem = problemDomain.ProblemPickerCandidate;
  export type CandidateProblemGroups = problemDomain.ProblemPickerGroups;
</script>

<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { problemLetter } from "@nojv/core";

  import { m } from "$lib/paraglide/messages.js";
  import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css";
  import { moveItem } from "$lib/utils/reorder";
  import { matchesProblemPickerSearch } from "$lib/utils/problem-picker";

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
  let searchQuery = $state("");
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

  const selectedIds = $derived(new Set(editRows.map((r) => r.problemId)));

  const filteredCandidateSections = $derived.by(() => {
    return [
      {
        key: "public",
        label: m.problems_publicLibrary(),
        problems: candidateProblems.publicProblems,
      },
      {
        key: "personal",
        label: m.problems_myProblems(),
        problems: candidateProblems.personalProblems,
      },
    ]
      .map((section) => ({
        ...section,
        problems: section.problems
          .filter((candidate) => !selectedIds.has(candidate.id))
          .filter((candidate) => matchesProblemPickerSearch(candidate, searchQuery))
          .slice(0, 20),
      }))
      .filter((section) => section.problems.length > 0);
  });

  function attach(candidate: CandidateProblem) {
    editRows = [
      ...editRows,
      {
        problemId: candidate.id,
        title: candidate.title,
        letter: problemLetter(editRows.length + 1),
      },
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
  <div class="mb-4 flex items-baseline justify-between gap-4">
    <h2 class="text-title font-medium leading-tight">
      {#if canEdit}
        {m.assignmentDetail_problemsEditHeading()}
      {:else}
        {m.assignmentDetail_teacherProblemsHeading()}
      {/if}
    </h2>
    <span class="text-caption text-muted-foreground">
      {canEdit ? m.common_dragToReorder() : m.assignmentDetail_teacherProblemsHint()}
    </span>
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
              variant="outline"
              size="sm"
              type="button"
              onclick={() => (rejudgeProblemId = problem.problemId)}
            >
              <RotateCcw class="size-3" aria-hidden="true" />
              {m.rejudge_problem_admin_button()}
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
                  variant="outline"
                  size="sm"
                  type="button"
                  onclick={() => (rejudgeProblemId = row.problemId)}
                >
                  <RotateCcw class="size-3" aria-hidden="true" />
                  {m.rejudge_problem_admin_button()}
                </Button>
              {/if}
              <Button
                href={`/assignments/${assignmentId}/problems/${row.problemId}`}
                variant="outline"
                size="sm"
              >
                {m.problemDetail_previewProblem()}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={m.assignmentDetail_problemsEditDetachButton()}
              onclick={() => detach(row.problemId)}
            >
              <X class="size-4" aria-hidden="true" />
            </Button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="mt-4 rounded-md border border-border bg-[color:var(--color-panel-strong)]/40">
      <div class="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5">
        <Search class="size-4 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          placeholder={m.assignmentDetail_problemsEditSearchPlaceholder()}
          bind:value={searchQuery}
          class="flex-1 border-none bg-transparent text-body-sm outline-none"
        />
      </div>
      <div class="max-h-[220px] overflow-y-auto p-1.5">
        {#if filteredCandidateSections.length === 0}
          <p class="px-3 py-6 text-center text-caption text-muted-foreground">
            {m.assignmentDetail_problemsEditEmptyHint()}
          </p>
        {:else}
          {#each filteredCandidateSections as section (section.key)}
            <section>
              <h3
                class="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground"
              >
                {section.label}
              </h3>
              {#each section.problems as candidate (candidate.id)}
                <button
                  type="button"
                  onclick={() => attach(candidate)}
                  class="flex w-full items-center gap-3.5 rounded-md px-3 py-2.5 text-left transition-colors duration-fast hover:bg-muted"
                >
                  <span class="min-w-[80px] font-mono text-caption text-muted-foreground">
                    {candidate.displayId == null
                      ? m.common_problemDraft()
                      : `#${candidate.displayId}`}
                  </span>
                  <span class="flex-1 text-body-sm font-medium">{candidate.title}</span>
                  <span
                    class={cn(
                      "text-micro font-semibold uppercase tracking-wider",
                      difficultyClass(candidate.difficulty),
                    )}
                  >
                    {candidate.difficulty}
                  </span>
                  <span
                    class="flex size-6 items-center justify-center rounded-sm bg-muted text-muted-foreground"
                  >
                    <Plus class="size-3.5" aria-hidden="true" />
                  </span>
                </button>
              {/each}
            </section>
          {/each}
        {/if}
      </div>
    </div>

    <div class="flex items-center justify-end gap-2 pt-3">
      <Button type="button" variant="default" size="sm" disabled={saving} onclick={savePayload}>
        {m.assignmentDetail_problemsEditSaveButton()}
      </Button>
    </div>
  {/if}
</section>

{#if rejudgeProblemId}
  <RejudgeDialog
    problemId={rejudgeProblemId}
    open={true}
    scope={{ type: "assignment", id: assignmentId }}
    onOpenChange={closeRejudgeDialog}
  />
{/if}
