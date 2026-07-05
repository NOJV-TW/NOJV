<script lang="ts" module>
  import type { examDomain } from "@nojv/application";

  export type ProblemsTabDetail = examDomain.ExamDetailPage;
  export type ProblemsLiveStatus = "draft" | "upcoming" | "running" | "ended";
</script>

<script lang="ts">
  import { enhance } from "$app/forms";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";

  import RejudgeDialog from "$lib/components/features/problem/admin/RejudgeDialog.svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn, inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";
  import type { ActionData } from "../../../../../routes/(app)/exams/[examId]/$types";

  interface Props {
    detail: ProblemsTabDetail;
    liveStatus?: ProblemsLiveStatus;
    canEdit: boolean;
    canRejudge?: boolean;
    form?: ActionData;
    class?: string;
  }

  let { detail, canEdit, canRejudge = false, form, class: className }: Props = $props();

  let ids = $state<string[]>([]);
  let attachInput = $state("");
  let rejudgeProblemId = $state<string | null>(null);

  $effect(() => {
    ids = detail.problems.map((p) => p.id);
  });

  const byId = $derived(new Map(detail.problems.map((p) => [p.id, p])));

  function move(id: string, delta: -1 | 1) {
    const idx = ids.indexOf(id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= ids.length) return;
    const next = ids.slice();
    [next[idx], next[target]] = [next[target] as string, next[idx] as string];
    ids = next;
  }

  function detach(id: string) {
    ids = ids.filter((x) => x !== id);
  }

  function difficultyClass(d: "easy" | "medium" | "hard"): string {
    if (d === "easy") return "text-success";
    if (d === "medium") return "text-warning";
    return "text-destructive";
  }

  function closeRejudgeDialog(open: boolean) {
    if (!open) rejudgeProblemId = null;
  }
</script>

<section
  data-slot="exam-problems-tab"
  class={cn("rounded-xl border border-border bg-[color:var(--color-panel)] p-4", className)}
>
  <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-title font-medium">
      {m.examDetail_problemsEditHeading()}
    </h2>
    <span class="text-caption text-muted-foreground">
      {canEdit ? m.examDetail_problemsHint() : m.examDetail_problemsEditFrozenHint()}
    </span>
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
    <form method="POST" action="?/updateProblems" use:enhance class="space-y-3">
      <ul class="space-y-2.5">
        {#each ids as id, index (id)}
          {@const problem = byId.get(id)}
          {#if problem}
            <li
              class="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle px-4 py-3"
            >
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
                      variant="outline"
                      size="sm"
                      type="button"
                      onclick={() => (rejudgeProblemId = id)}
                    >
                      <RotateCcw class="size-3" aria-hidden="true" />
                      {m.rejudge_problem_admin_button()}
                    </Button>
                  {/if}
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={index === 0}
                    onclick={() => move(id, -1)}
                    aria-label={m.examDetail_problemsEditMoveUp()}
                  >
                    <ChevronUp aria-hidden="true" class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={index === ids.length - 1}
                    onclick={() => move(id, 1)}
                    aria-label={m.examDetail_problemsEditMoveDown()}
                  >
                    <ChevronDown aria-hidden="true" class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-[color:var(--color-destructive)]/8 hover:text-destructive"
                    onclick={() => detach(id)}
                    aria-label={m.examDetail_problemsEditDetachButton()}
                  >
                    <X aria-hidden="true" class="h-4 w-4" />
                  </button>
                </div>
              {:else}
                <div class="flex items-center gap-2">
                  {#if canRejudge}
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onclick={() => (rejudgeProblemId = problem.id)}
                    >
                      <RotateCcw class="size-3" aria-hidden="true" />
                      {m.rejudge_problem_admin_button()}
                    </Button>
                  {/if}
                  <Button href={`/problems/${problem.id}`} variant="outline" size="sm">
                    {m.examDetail_problemPreview()}
                  </Button>
                </div>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>

      {#each ids as id (id)}
        <input type="hidden" name="problemIds" value={id} />
      {/each}

      {#if canEdit}
        <div class="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" size="sm" variant="default">
            {m.examDetail_problemsEditSaveButton()}
          </Button>
        </div>
      {/if}
    </form>
  {/if}

  {#if canEdit}
    <form
      method="POST"
      action="?/updateProblems"
      use:enhance
      class="mt-6 flex items-end gap-2 border-t border-border-subtle pt-4"
    >
      <div class="flex-1">
        <label class="text-caption font-semibold text-muted-foreground" for="attach-input">
          {m.examDetail_problemsEditAttachLabel()}
        </label>
        <input
          id="attach-input"
          type="text"
          class={inputClassName}
          bind:value={attachInput}
          placeholder="prob_01JA…"
        />
      </div>

      {#each ids as id (id)}
        <input type="hidden" name="problemIds" value={id} />
      {/each}
      {#if attachInput.trim().length > 0}
        <input type="hidden" name="problemIds" value={attachInput.trim()} />
      {/if}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={attachInput.trim().length === 0}
      >
        <Plus class="mr-1 h-4 w-4" aria-hidden="true" />
        {m.examDetail_problemsEditAttachButton()}
      </Button>
    </form>
  {/if}
</section>

{#if rejudgeProblemId}
  <RejudgeDialog
    problemId={rejudgeProblemId}
    open={true}
    scope={{ type: "exam", id: detail.id }}
    onOpenChange={closeRejudgeDialog}
  />
{/if}
