<script lang="ts">
  import { enhance } from "$app/forms";
  import { tick } from "svelte";
  import Eye from "@lucide/svelte/icons/eye";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import ProblemSelectDialog, {
    type CandidateProblem,
  } from "$lib/components/features/problem/ProblemSelectDialog.svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let search = $state("");
  let pickerOpen = $state(false);
  let adding = $state(false);
  let removingId = $state<string | null>(null);
  let problemIds = $state<string[]>([]);
  let addForm = $state<HTMLFormElement>();

  const library = $derived(data.library);
  const selectedIds = $derived(
    library.problems
      .filter((problem) => problem.visibility === "private")
      .map((problem) => problem.id),
  );
  const problems = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase().replace(/^#/, "");
    return library.problems.filter((problem) =>
      [
        problem.title,
        problem.id,
        problem.displayId,
        problem.author.name,
        problem.author.username,
      ].some((value) =>
        String(value ?? "")
          .toLocaleLowerCase()
          .includes(query),
      ),
    );
  });
  const error = $derived(form && "error" in form ? form.error : null);
  const success = $derived(
    form && "added" in form
      ? m.course_problemLibraryAdded()
      : form && "removed" in form
        ? m.course_problemLibraryRemoved()
        : null,
  );

  async function addProblems(problems: CandidateProblem[]) {
    problemIds = problems.map((problem) => problem.id);
    await tick();
    addForm?.requestSubmit();
  }
</script>

<svelte:head>
  <title>{m.course_problemLibrary()} · {library.course.title}</title>
</svelte:head>

<PageContainer class="space-y-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="space-y-2">
      <h1 class="text-title-lg font-semibold">{m.course_problemLibrary()}</h1>
      <p class="max-w-2xl text-body-sm text-muted-foreground">
        {m.course_problemLibraryDescription()}
      </p>
    </div>
    {#if !library.course.archived}
      <form
        method="POST"
        action="?/add"
        bind:this={addForm}
        use:enhance={() => {
          adding = true;
          return async ({ update }) => {
            try {
              await update();
            } finally {
              adding = false;
            }
          };
        }}
      >
        {#each problemIds as id (id)}
          <input type="hidden" name="problemIds" value={id} />
        {/each}
        <Button
          type="button"
          disabled={adding}
          aria-busy={adding}
          onclick={() => (pickerOpen = true)}
        >
          <Plus class="size-4" aria-hidden="true" />
          {m.course_problemLibraryAdd()}
        </Button>
      </form>
    {/if}
  </div>

  {#if library.course.archived}
    <p
      role="status"
      class="rounded-md border border-border-subtle px-4 py-3 text-body-sm text-muted-foreground"
    >
      {m.problem_readOnly()}
    </p>
  {/if}
  {#if error}<p role="alert" class="text-body-sm text-destructive">{error}</p>{/if}
  {#if success}<p role="status" class="text-body-sm text-success">{success}</p>{/if}

  <div class="flex items-center gap-3 border-b border-border-subtle pb-3">
    <Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <input
      type="search"
      bind:value={search}
      aria-label={m.course_problemLibrarySearch()}
      placeholder={m.course_problemLibrarySearch()}
      class="min-w-0 flex-1 rounded-sm bg-transparent text-body-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
    />
    <span class="text-caption tabular-nums text-muted-foreground"
      >{problems.length} / {library.problems.length}</span
    >
  </div>

  {#if problems.length === 0}
    <p class="py-12 text-center text-body-sm text-muted-foreground">
      {library.problems.length === 0
        ? m.course_problemLibraryEmpty()
        : m.problemPicker_searchEmpty()}
    </p>
  {:else}
    <ul class="divide-y divide-border-subtle">
      {#each problems as problem (problem.id)}
        <li
          data-problem-id={problem.id}
          class="flex flex-wrap items-start gap-4 py-5 first:pt-0"
        >
          <div class="min-w-0 flex-1 basis-64 space-y-3">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="font-mono text-caption text-muted-foreground">
                {problem.displayId == null ? m.common_problemDraft() : `#${problem.displayId}`}
              </span>
              <a
                class="break-words text-body font-semibold hover:underline"
                href={`/problems/${problem.id}`}>{problem.title}</a
              >
              <span class="text-caption text-muted-foreground">
                {problem.status === "draft"
                  ? m.common_problemDraft()
                  : m.admin_announcementsPublished()}
                · {problem.visibility === "private"
                  ? m.admin_visibilityPrivate()
                  : m.admin_visibilityPublic()}
              </span>
            </div>
            <dl class="flex flex-wrap gap-x-6 gap-y-2 text-caption">
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted-foreground">{m.course_problemLibraryOwner()}</dt>
                <dd>
                  {#if problem.author.username}
                    <a class="hover:underline" href={`/users/${problem.author.username}`}
                      >{problem.author.name || problem.author.username}</a
                    >
                  {:else}{problem.author.name}{/if}
                </dd>
              </div>
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted-foreground">{m.course_problemLibrarySource()}</dt>
                <dd>
                  {#if problem.forkedFromProblemId}
                    <a
                      class="hover:underline"
                      href={`/problems/${problem.forkedFromProblemId}`}
                      title={m.course_problemLibrarySourceLink()}
                      >{m.course_problemLibraryFork()}</a
                    >
                  {:else}
                    {problem.visibility === "public"
                      ? m.course_problemLibraryPublic()
                      : m.course_problemLibraryOriginal()}
                  {/if}
                </dd>
              </div>
            </dl>
            <div class="flex flex-wrap gap-x-4 gap-y-2 text-caption">
              {#each problem.assignments as assignment (assignment.id)}
                <a
                  class="text-muted-foreground hover:text-foreground hover:underline"
                  href={`/assignments/${assignment.id}`}
                  >{m.course_tabAssignments()}: {assignment.title}</a
                >
              {/each}
              {#each problem.exams as exam (exam.id)}
                <a
                  class="text-muted-foreground hover:text-foreground hover:underline"
                  href={`/exams/${exam.id}`}>{m.course_tabExams()}: {exam.title}</a
                >
              {/each}
              {#if problem.assignments.length === 0 && problem.exams.length === 0}
                <span class="text-muted-foreground">{m.course_problemLibraryUnused()}</span>
              {/if}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              href={`/problems/${problem.id}`}
              aria-label={m.problemDetail_previewProblem()}
              title={m.problemDetail_previewProblem()}
            >
              <Eye class="size-4" aria-hidden="true" />
            </Button>
            {#if !library.course.archived && problem.canEdit}
              <Button
                variant="ghost"
                size="icon-sm"
                href={`/problems/${problem.id}/edit`}
                aria-label={m.common_edit()}
                title={m.common_edit()}
              >
                <Pencil class="size-4" aria-hidden="true" />
              </Button>
            {/if}
            {#if !library.course.archived}
              <form
                method="POST"
                action="?/remove"
                use:enhance={() => {
                  removingId = problem.id;
                  return async ({ update }) => {
                    try {
                      await update();
                    } finally {
                      removingId = null;
                    }
                  };
                }}
              >
                <input type="hidden" name="problemId" value={problem.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  class="hover:text-destructive"
                  disabled={!problem.canRemove || removingId !== null}
                  aria-busy={removingId === problem.id}
                  aria-label={m.course_problemLibraryRemove()}
                  title={problem.canRemove
                    ? m.course_problemLibraryRemove()
                    : m.course_problemLibraryInUse()}
                >
                  <Trash2 class="size-4" aria-hidden="true" />
                </Button>
              </form>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if !library.course.archived}
      <p class="text-caption text-muted-foreground">{m.course_problemLibraryRemoveHint()}</p>
    {/if}
  {/if}
</PageContainer>

{#if !library.course.archived}
  <ProblemSelectDialog
    bind:open={pickerOpen}
    candidateProblems={data.candidateProblems}
    {selectedIds}
    mode="library"
    onConfirm={addProblems}
  />
{/if}
