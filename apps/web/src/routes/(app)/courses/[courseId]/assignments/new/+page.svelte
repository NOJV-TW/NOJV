<script lang="ts">
  import { untrack } from "svelte";
  import { ChevronRight, GripVertical, Info, Plus, Search, X } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import LatePenaltyRuleBuilder, {
    type LatePenaltyRule
  } from "$lib/components/features/course/LatePenaltyRuleBuilder.svelte";
  import type { FormMessage } from "$lib/types/form-message";
  import { toggleArrayItem } from "$lib/utils";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    { dataType: "json", resetForm: false }
  );

  let searchQuery = $state("");
  let advancedOpen = $state(true);

  const problemById = $derived(
    new Map(data.candidateProblems?.map((p) => [p.id, p]) ?? [])
  );

  const filteredProblems = $derived.by(() => {
    const rows = data.candidateProblems ?? [];
    const selected = new Set($form.problemIds);
    const q = searchQuery.trim().toLowerCase();
    const available = rows.filter((p) => !selected.has(p.id));
    if (q.length === 0) return available.slice(0, 30);
    return available
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      )
      .slice(0, 30);
  });

  const selectedProblems = $derived(
    $form.problemIds.map((id) => problemById.get(id)).filter((p) => p !== undefined)
  );

  function addProblem(id: string) {
    if (!$form.problemIds.includes(id)) {
      $form.problemIds = [...$form.problemIds, id];
    }
  }

  function removeProblem(id: string) {
    $form.problemIds = $form.problemIds.filter((x) => x !== id);
  }

  function moveProblem(fromIdx: number, toIdx: number) {
    if (toIdx < 0 || toIdx >= $form.problemIds.length || fromIdx === toIdx) return;
    const next = [...$form.problemIds];
    const [item] = next.splice(fromIdx, 1);
    if (item !== undefined) {
      next.splice(toIdx, 0, item);
    }
    $form.problemIds = next;
  }

  let dragIndex = $state<number | null>(null);

  function handleDragStart(index: number) {
    dragIndex = index;
  }
  function handleDragOver(event: DragEvent) {
    event.preventDefault();
  }
  function handleDrop(dropIndex: number) {
    if (dragIndex === null) return;
    moveProblem(dragIndex, dropIndex);
    dragIndex = null;
  }

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function handleLatePenaltyChange(value: LatePenaltyRule) {
    $form.latePenalty = value;
  }

  // Map zod/prisma difficulty to the prototype color class.
  function difficultyClass(d: "easy" | "medium" | "hard"): string {
    if (d === "easy") return "text-success";
    if (d === "hard") return "text-destructive";
    return "text-warning";
  }

  function difficultyLabel(d: "easy" | "medium" | "hard"): string {
    if (d === "easy") return m.admin_difficultyEasy();
    if (d === "hard") return m.admin_difficultyHard();
    return m.admin_difficultyMedium();
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  const courseId = $derived(data.form.data.courseId ?? "");
</script>

<div class="mx-auto w-full max-w-4xl pb-24">
  <PageHero
    variant="workspace"
    breadcrumbHref={`/courses/${courseId}/assignments`}
    breadcrumbLabel={m.assignmentCreate_breadcrumb()}
    eyebrow={m.assignmentCreate_eyebrow()}
    title={m.assignmentCreate_title()}
  />
  <p class="animate-in mt-4 mb-8 max-w-2xl text-body-sm text-muted-foreground">
    {m.assignmentCreate_subtitle()}
  </p>

  <form method="POST" use:enhance class="animate-in animate-in-1 space-y-6">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <!-- Card 1 — Basics -->
    <div
      class="rounded-xl border border-border bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
    >
      <div class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          aria-hidden="true"
        >
          1
        </span>
        <div>
          <h2 class="text-title-sm font-medium tracking-[-0.01em]">
            {m.assignmentCreate_basicsTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.assignmentCreate_basicsSubtitle()}
          </p>
        </div>
      </div>

      <div>
        <label class="text-body-sm font-medium" for="title">
          {m.assignmentCreate_titleLabel()}
          <span class="text-destructive">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder={m.assignmentCreate_titlePlaceholder()}
          bind:value={$form.title}
          class="mt-2 {inputClass}"
        />
        {#if $errors.title}
          <p class="mt-1 text-caption text-destructive">{$errors.title}</p>
        {/if}
      </div>
    </div>

    <!-- Card 2 — Problems -->
    <div
      class="rounded-xl border border-border bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
    >
      <div class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          aria-hidden="true"
        >
          2
        </span>
        <div>
          <h2 class="text-title-sm font-medium tracking-[-0.01em]">
            {m.assignmentCreate_problemsTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.assignmentCreate_problemsSubtitle()}
          </p>
        </div>
      </div>

      <!-- Picker: search + dropdown -->
      <div class="rounded-md border border-border bg-[color:var(--color-panel-strong)]/40">
        <div class="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
          <Search class="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder={m.assignmentCreate_searchPlaceholder()}
            bind:value={searchQuery}
            class="flex-1 border-none bg-transparent text-body-sm outline-none"
          />
          <span class="text-caption text-muted-foreground">
            {m.assignmentCreate_resultsCount({ count: filteredProblems.length })}
          </span>
        </div>
        <div class="max-h-[220px] overflow-y-auto p-1.5">
          {#if filteredProblems.length === 0}
            <p class="px-3 py-6 text-center text-caption text-muted-foreground">
              {m.assignmentCreate_noResults()}
            </p>
          {:else}
            {#each filteredProblems as problem (problem.id)}
              <button
                type="button"
                onclick={() => addProblem(problem.id)}
                class="flex w-full items-center gap-3.5 rounded-md px-3 py-2.5 text-left transition-colors duration-fast hover:bg-muted"
              >
                <span
                  class="min-w-[80px] font-mono text-caption text-muted-foreground"
                >
                  #{problem.displayId}
                </span>
                <span class="flex-1 text-body-sm font-medium">{problem.title}</span>
                <span
                  class="text-micro font-semibold uppercase tracking-wider {difficultyClass(
                    problem.difficulty
                  )}"
                >
                  {difficultyLabel(problem.difficulty)}
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

      <!-- Selected list with drag-to-reorder -->
      {#if selectedProblems.length > 0}
        <div class="mt-4">
          <div
            class="flex items-center justify-between px-1 pb-2 text-caption font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <span>
              {m.assignmentCreate_selectedHeader({ count: selectedProblems.length })}
            </span>
            <span>{m.assignmentCreate_sortHint()}</span>
          </div>
          {#each selectedProblems as problem, index (problem.id)}
            <div
              role="listitem"
              draggable="true"
              ondragstart={() => handleDragStart(index)}
              ondragover={handleDragOver}
              ondrop={() => handleDrop(index)}
              class="mt-2 grid grid-cols-[auto_auto_1fr_auto_auto_auto] items-center gap-4 rounded-md border border-border bg-[color:var(--color-panel)] px-4 py-3 transition-[border-color,box-shadow] duration-fast hover:border-border-strong hover:shadow-rest"
            >
              <span class="cursor-grab text-muted-foreground hover:text-foreground">
                <GripVertical class="size-4" aria-hidden="true" />
              </span>
              <span
                class="min-w-[20px] text-center text-title-sm text-muted-foreground"
              >
                {index + 1}
              </span>
              <div class="min-w-0">
                <div class="truncate text-body-sm font-medium">{problem.title}</div>
                <div class="mt-0.5 font-mono text-caption text-muted-foreground">
                  #{problem.displayId}
                </div>
              </div>
              <span
                class="text-micro font-semibold uppercase tracking-wider {difficultyClass(
                  problem.difficulty
                )}"
              >
                {difficultyLabel(problem.difficulty)}
              </span>
              <Badge variant="muted" size="sm">100</Badge>
              <button
                type="button"
                aria-label={m.assignmentCreate_removeProblem()}
                onclick={() => removeProblem(problem.id)}
                class="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X class="size-3.5" aria-hidden="true" />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Zero-problems info note — key UX change vs contest -->
      <div
        class="mt-4 flex items-start gap-3.5 rounded-md border border-dashed border-info/30 bg-info/5 px-5 py-4 text-body-sm leading-relaxed text-muted-foreground"
      >
        <Info class="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
        <div>
          <strong class="font-semibold text-foreground"
            >{m.assignmentCreate_emptyAllowedHeadline()}</strong
          >
          {m.assignmentCreate_emptyAllowedHint()}
        </div>
      </div>

      {#if $errors.problemIds}
        <p class="mt-2 text-caption text-destructive">{$errors.problemIds}</p>
      {/if}
    </div>

    <!-- Card 3 — Schedule -->
    <div
      class="rounded-xl border border-border bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
    >
      <div class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          aria-hidden="true"
        >
          3
        </span>
        <div>
          <h2 class="text-title-sm font-medium tracking-[-0.01em]">
            {m.assignmentCreate_scheduleTitle()}
            <span class="text-destructive">*</span>
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.assignmentCreate_scheduleSubtitle()}
          </p>
        </div>
      </div>

      <div class="grid gap-5 md:grid-cols-3">
        <div>
          <label class="text-body-sm font-medium" for="opensAt">
            {m.assignmentCreate_opensLabel()}
          </label>
          <input
            id="opensAt"
            name="opensAt"
            type="datetime-local"
            bind:value={$form.opensAt}
            class="mt-2 {inputClass}"
          />
          {#if $errors.opensAt}
            <p class="mt-1 text-caption text-destructive">{$errors.opensAt}</p>
          {/if}
        </div>
        <div>
          <label class="text-body-sm font-medium" for="dueAt">
            {m.assignmentCreate_dueLabel()}
          </label>
          <input
            id="dueAt"
            name="dueAt"
            type="datetime-local"
            bind:value={$form.dueAt}
            class="mt-2 {inputClass}"
          />
          {#if $errors.dueAt}
            <p class="mt-1 text-caption text-destructive">{$errors.dueAt}</p>
          {/if}
        </div>
        <div>
          <label class="text-body-sm font-medium" for="closesAt">
            {m.assignmentCreate_finalDayLabel()}
          </label>
          <input
            id="closesAt"
            name="closesAt"
            type="datetime-local"
            bind:value={$form.closesAt}
            class="mt-2 {inputClass}"
          />
          {#if $errors.closesAt}
            <p class="mt-1 text-caption text-destructive">{$errors.closesAt}</p>
          {/if}
        </div>
      </div>
    </div>

    <!-- Card 4 — Advanced -->
    <div
      class="rounded-xl border border-border bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
    >
      <button
        type="button"
        onclick={() => (advancedOpen = !advancedOpen)}
        class="flex w-full cursor-pointer items-center gap-2 text-left"
        aria-expanded={advancedOpen}
      >
        <span class="transition-transform duration-fast {advancedOpen ? 'rotate-90' : ''}">
          <ChevronRight class="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 class="text-title-sm font-medium tracking-[-0.01em]">
            {m.assignmentCreate_advancedTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.assignmentCreate_advancedSubtitle()}
          </p>
        </div>
      </button>

      {#if advancedOpen}
        <div class="mt-6 space-y-6 border-t border-border-subtle pt-6">
          <!-- Allowed languages -->
          <div>
            <label class="text-body-sm font-medium" for="allowedLanguages">
              {m.assignmentCreate_languagesLabel()}
            </label>
            <p class="mt-1 text-caption text-muted-foreground">
              {m.assignmentCreate_languagesDesc()}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              {#each supportedLanguages as lang (lang)}
                {@const checked = ($form.allowedLanguages ?? []).includes(lang)}
                <button
                  type="button"
                  onclick={() => toggleLanguage(lang)}
                  class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-body-sm font-medium transition-colors duration-fast {checked
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-[color:var(--color-panel)]'}"
                >
                  {lang}
                </button>
              {/each}
            </div>
          </div>

          <!-- Max attempts per day -->
          <div>
            <label class="text-body-sm font-medium" for="maxAttemptsPerDay">
              {m.assignmentCreate_maxAttemptsLabel()}
            </label>
            <input
              id="maxAttemptsPerDay"
              name="maxAttemptsPerDay"
              type="number"
              min="1"
              max="999"
              placeholder={m.assignmentCreate_maxAttemptsPlaceholder()}
              bind:value={$form.maxAttemptsPerDay}
              class="mt-2 {inputClass} max-w-[200px]"
            />
            <p class="mt-1 text-caption text-muted-foreground">
              {m.assignmentCreate_maxAttemptsDesc()}
            </p>
            {#if $errors.maxAttemptsPerDay}
              <p class="mt-1 text-caption text-destructive">
                {$errors.maxAttemptsPerDay}
              </p>
            {/if}
          </div>

          <!-- Late penalty -->
          <div>
            <label class="text-body-sm font-medium" for="latePenalty">
              {m.assignmentCreate_latePenaltyLabel()}
            </label>
            <p class="mt-1 mb-3 text-caption text-muted-foreground">
              {m.assignmentCreate_latePenaltyDesc()}
            </p>
            <LatePenaltyRuleBuilder
              value={$form.latePenalty as LatePenaltyRule}
              onChange={handleLatePenaltyChange}
            />
          </div>
        </div>
      {/if}
    </div>

    <!-- Hidden field: courseId travels with the form so the zod schema
         sees it, even though the server action reads it from params.  -->
    <input type="hidden" name="courseId" value={$form.courseId} />

    <!-- Form actions -->
    <div
      class="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-6"
    >
      <span class="mr-auto text-caption text-muted-foreground">
        {m.assignmentCreate_hintDraftTaVisible()}
      </span>
      <Button href={`/courses/${courseId}/assignments`} variant="ghost">
        {m.assignmentCreate_cancel()}
      </Button>
      <Button
        type="submit"
        variant="outline"
        formaction="?/saveDraft"
        disabled={$submitting}
      >
        {m.assignmentCreate_saveDraft()}
      </Button>
      <Button type="submit" formaction="?/publish" disabled={$submitting}>
        {m.assignmentCreate_publish()}
      </Button>
    </div>
  </form>
</div>
