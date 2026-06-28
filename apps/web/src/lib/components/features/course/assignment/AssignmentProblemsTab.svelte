<script lang="ts" module>
  import type { courseDomain, problemDomain } from "@nojv/application";

  export type ProblemsTabProblem = courseDomain.AssignmentDetailProblem;
  export type CandidateProblem = Awaited<
    ReturnType<typeof problemDomain.listEditableProblems>
  >[number];
</script>

<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";

  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css";

  interface Props {
    problems: ProblemsTabProblem[];
    assignmentId: string;
    canEdit?: boolean;
    candidateProblems?: CandidateProblem[];
    class?: string;
  }

  let {
    problems,
    assignmentId,
    canEdit = false,
    candidateProblems = [],
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

  const filteredCandidates = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    const available = candidateProblems.filter((c) => !selectedIds.has(c.id));
    if (q.length === 0) return available.slice(0, 20);
    return available
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .slice(0, 20);
  });

  function letterFor(ordinal: number): string {
    if (ordinal < 1) return String(ordinal);
    let n = ordinal;
    let label = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      label = String.fromCharCode(65 + rem) + label;
      n = Math.floor((n - 1) / 26);
    }
    return label;
  }

  function attach(candidate: CandidateProblem) {
    editRows = [
      ...editRows,
      {
        problemId: candidate.id,
        title: candidate.title,
        letter: letterFor(editRows.length + 1),
      },
    ];
  }

  function detach(problemId: string) {
    editRows = editRows
      .filter((r) => r.problemId !== problemId)
      .map((r, i) => ({ ...r, letter: letterFor(i + 1) }));
  }

  function swap(i: number, j: number) {
    if (i < 0 || j < 0 || i >= editRows.length || j >= editRows.length) return;
    const next = [...editRows];
    const tmp = next[i];
    const other = next[j];
    if (!tmp || !other) return;
    next[i] = other;
    next[j] = tmp;
    editRows = next.map((r, idx) => ({ ...r, letter: letterFor(idx + 1) }));
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
      {m.assignmentDetail_teacherProblemsHint()}
    </span>
  </div>

  {#if !canEdit}
    <div class="grid gap-3">
      {#each problems as problem (problem.problemId)}
        <a
          href={`/assignments/${assignmentId}/problems/${problem.problemId}`}
          class="group grid grid-cols-[auto_1fr_auto] items-center gap-5 rounded-md border border-border-subtle bg-[color:var(--color-panel)] px-5 py-4 no-underline transition-[transform,border-color,box-shadow] duration-fast ease-out-soft hover:translate-x-[2px] hover:border-border-strong hover:shadow-rest"
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
          <div class="text-right text-caption text-muted-foreground tabular-nums leading-snug">
            <span class="block text-title-sm font-medium text-foreground">—</span>
            {m.assignmentDetail_teacherProblemsClassPending()}
          </div>
        </a>
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
        {#each editRows as row, index (row.problemId)}
          <div
            class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-md border border-border bg-[color:var(--color-panel)] px-4 py-3"
          >
            <div
              class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-body-lg font-medium text-muted-foreground"
            >
              {row.letter}
            </div>
            <div class="min-w-0">
              <div class="truncate text-body-sm font-semibold">{row.title}</div>
              <div class="font-mono text-caption text-muted-foreground">{row.problemId}</div>
            </div>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={m.assignmentDetail_problemsEditMoveUp()}
                disabled={index === 0}
                onclick={() => swap(index, index - 1)}
              >
                <ArrowUp class="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={m.assignmentDetail_problemsEditMoveDown()}
                disabled={index === editRows.length - 1}
                onclick={() => swap(index, index + 1)}
              >
                <ArrowDown class="size-4" aria-hidden="true" />
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
        {#if filteredCandidates.length === 0}
          <p class="px-3 py-6 text-center text-caption text-muted-foreground">
            {m.assignmentDetail_problemsEditEmptyHint()}
          </p>
        {:else}
          {#each filteredCandidates as candidate (candidate.id)}
            <button
              type="button"
              onclick={() => attach(candidate)}
              class="flex w-full items-center gap-3.5 rounded-md px-3 py-2.5 text-left transition-colors duration-fast hover:bg-muted"
            >
              <span class="min-w-[80px] font-mono text-caption text-muted-foreground">
                {candidate.id}
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
