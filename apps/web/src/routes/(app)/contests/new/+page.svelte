<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { superForm } from "sveltekit-superforms/client";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { problemLetter } from "$lib/components/features/contest/format";
  import { inputClassName } from "$lib/utils/css";
  import { moveItem } from "$lib/utils/reorder";
  import { toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import CodeIcon from "@lucide/svelte/icons/code";
  import ListIcon from "@lucide/svelte/icons/list";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ProblemPicker from "$lib/components/features/course/exam/ProblemPicker.svelte";
  import { Card } from "$lib/components/primitives/ui/card/index.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";
  import {
    contestScoringOptions,
    contestScoringModeHelp,
    contestModeUsesPoints,
  } from "$lib/utils/contest-scoring";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";

  let { data } = $props();

  const {
    form,
    errors,
    enhance,
    submitting,
    message: formMessage,
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    {
      dataType: "json",
      resetForm: false,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.contestCreate_success());
          goto("/contests");
        }
      },
    },
  );

  const showPointsInput = $derived(contestModeUsesPoints($form.scoringMode));
  let selectedProblemIds = $state(
    $form.problems.map((problem) => problem.problemId).filter((id) => id.length > 0),
  );
  let draggedIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);
  const candidateProblemById = $derived(
    new Map(
      [
        ...data.candidateProblems.publicProblems,
        ...data.candidateProblems.personalProblems,
      ].map((problem) => [problem.id, problem]),
    ),
  );

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function updateProblemIds(ids: string[]) {
    const pointsById = new Map(
      $form.problems.map((problem) => [problem.problemId, problem.points]),
    );
    selectedProblemIds = ids;
    $form.problems = ids.map((problemId) => ({
      problemId,
      points: pointsById.get(problemId) ?? 100,
    }));
  }

  function removeProblem(index: number) {
    updateProblemIds($form.problems.filter((_, i) => i !== index).map((p) => p.problemId));
  }

  function reorderProblems(from: number, to: number) {
    $form.problems = moveItem($form.problems, from, to);
    selectedProblemIds = $form.problems.map((problem) => problem.problemId);
  }

  function handleDragStart(event: DragEvent, index: number) {
    draggedIndex = index;
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent, index: number) {
    if (draggedIndex === null) return;
    event.preventDefault();
    dragOverIndex = draggedIndex === index ? null : index;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const sourceIndex = draggedIndex ?? Number(event.dataTransfer?.getData("text/plain"));
    if (Number.isInteger(sourceIndex) && sourceIndex !== targetIndex) {
      reorderProblems(sourceIndex, targetIndex);
    }
    draggedIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
  }

  function handleHandleKeydown(event: KeyboardEvent, index: number) {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = index + delta;
    if (delta === 0 || target < 0 || target >= $form.problems.length) return;
    event.preventDefault();
    reorderProblems(index, target);
  }
</script>

<PageContainer width="form" class="space-y-6">
  <PageHero
    variant="workspace"
    breadcrumbHref="/contests"
    breadcrumbLabel={m.contestCreate_breadcrumb()}
    eyebrow={m.contestCreate_eyebrow()}
    title={m.contestCreate_title()}
  />

  <Card variant="surface" size="hero" class="max-w-2xl">
    <form method="POST" action="?/create" use:enhance class="space-y-5">
      <FormError message={$formMessage?.kind === "error" ? m.contestCreate_error() : null} />
      <div>
        <label class="text-sm font-medium" for="id">{m.contestCreate_slug()}</label>
        <input
          class={inputClassName}
          id="id"
          name="id"
          type="text"
          placeholder={m.contestCreate_slugPlaceholder()}
          bind:value={$form.id}
          aria-invalid={Boolean($errors.id)}
          aria-describedby={$errors.id ? "id-error" : undefined}
        />
        {#if $errors.id}<p id="id-error" class="mt-1 text-xs text-destructive">
            {$errors.id}
          </p>{/if}
        <p class="mt-1 text-xs text-muted-foreground">{m.contestCreate_slugHint()}</p>
      </div>

      <div>
        <label class="text-sm font-medium" for="title">{m.contestCreate_titleField()}</label>
        <input
          class={inputClassName}
          id="title"
          name="title"
          type="text"
          placeholder={m.contestCreate_titlePlaceholder()}
          bind:value={$form.title}
          aria-invalid={Boolean($errors.title)}
          aria-describedby={$errors.title ? "title-error" : undefined}
        />
        {#if $errors.title}<p id="title-error" class="mt-1 text-xs text-destructive">
            {$errors.title}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="summary">{m.contestCreate_summary()}</label>
        <textarea
          class="{inputClassName} min-h-24 resize-y"
          id="summary"
          name="summary"
          placeholder={m.contestCreate_summaryPlaceholder()}
          bind:value={$form.summary}
          aria-invalid={Boolean($errors.summary)}
          aria-describedby={$errors.summary ? "summary-error" : undefined}></textarea>
        {#if $errors.summary}<p id="summary-error" class="mt-1 text-xs text-destructive">
            {$errors.summary}
          </p>{/if}
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ClockIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.common_timeline()}</span>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="text-sm font-medium" for="startsAt">{m.contestCreate_startsAt()}</label>
          <input
            class={inputClassName}
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            bind:value={$form.startsAt}
            aria-invalid={Boolean($errors.startsAt)}
            aria-describedby={$errors.startsAt ? "startsAt-error" : undefined}
          />
          {#if $errors.startsAt}<p id="startsAt-error" class="mt-1 text-xs text-destructive">
              {$errors.startsAt}
            </p>{/if}
        </div>
        <div>
          <label class="text-sm font-medium" for="endsAt">{m.contestCreate_endsAt()}</label>
          <input
            class={inputClassName}
            id="endsAt"
            name="endsAt"
            type="datetime-local"
            bind:value={$form.endsAt}
            aria-invalid={Boolean($errors.endsAt)}
            aria-describedby={$errors.endsAt ? "endsAt-error" : undefined}
          />
          {#if $errors.endsAt}<p id="endsAt-error" class="mt-1 text-xs text-destructive">
              {$errors.endsAt}
            </p>{/if}
        </div>
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <SettingsIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.contestCreate_scoringMode()}</span>
      </div>
      <div>
        <label class="flex items-center gap-1.5 text-sm font-medium" for="scoringMode">
          {m.contestCreate_scoringMode()}
          <HelpTooltip text={contestScoringModeHelp()} nowrap />
        </label>
        <select
          class={inputClassName}
          id="scoringMode"
          name="scoringMode"
          bind:value={$form.scoringMode}
        >
          {#each contestScoringOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label()}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="text-sm font-medium" for="submitCooldownSec"
          >{m.contestCreate_submitCooldown()}</label
        >
        <input
          class={inputClassName}
          id="submitCooldownSec"
          name="submitCooldownSec"
          type="number"
          min="0"
          max="3600"
          bind:value={$form.submitCooldownSec}
          aria-invalid={Boolean($errors.submitCooldownSec)}
          aria-describedby={$errors.submitCooldownSec ? "submitCooldownSec-error" : undefined}
        />
        {#if $errors.submitCooldownSec}<p
            id="submitCooldownSec-error"
            class="mt-1 text-xs text-destructive"
          >
            {$errors.submitCooldownSec}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="penaltyMinutesPerWrong"
          >{m.contestCreate_penaltyMinutes()}</label
        >
        <input
          class={inputClassName}
          id="penaltyMinutesPerWrong"
          name="penaltyMinutesPerWrong"
          type="number"
          min="0"
          max="1440"
          bind:value={$form.penaltyMinutesPerWrong}
          aria-invalid={Boolean($errors.penaltyMinutesPerWrong)}
          aria-describedby={$errors.penaltyMinutesPerWrong
            ? "penaltyMinutesPerWrong-error"
            : undefined}
        />
        {#if $errors.penaltyMinutesPerWrong}<p
            id="penaltyMinutesPerWrong-error"
            class="mt-1 text-xs text-destructive"
          >
            {$errors.penaltyMinutesPerWrong}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="scoreboardMode"
          >{m.contestCreate_scoreboardMode()}</label
        >
        <select
          class={inputClassName}
          id="scoreboardMode"
          name="scoreboardMode"
          bind:value={$form.scoreboardMode}
        >
          <option value="live">{m.contestDetail_live()}</option>
          <option value="frozen">{m.contestDetail_frozen()}</option>
          <option value="hidden">{m.contestCreate_scoreboardModeHidden()}</option>
        </select>
      </div>

      <div>
        <label class="text-sm font-medium" for="frozenAt">{m.contestCreate_freezeAt()}</label>
        <input
          class={inputClassName}
          id="frozenAt"
          name="frozenAt"
          type="datetime-local"
          bind:value={$form.frozenAt}
        />
      </div>

      <div>
        <label class="text-sm font-medium" for="isPublic">{m.contestCreate_visibility()}</label>
        <select class={inputClassName} id="isPublic" bind:value={$form.isPublic}>
          <option value={true}>{m.contestCreate_visibilityPublic()}</option>
          <option value={false}>{m.contestCreate_visibilityPrivate()}</option>
        </select>
        <p class="mt-1 text-xs text-muted-foreground">
          {m.contestCreate_visibilityHint()}
        </p>
      </div>

      {#if !$form.isPublic}
        <div>
          <label class="text-sm font-medium" for="inviteCode"
            >{m.contestCreate_inviteCode()}</label
          >
          <input
            class={inputClassName}
            id="inviteCode"
            name="inviteCode"
            type="text"
            placeholder={m.contestCreate_inviteCodePlaceholder()}
            bind:value={$form.inviteCode}
            aria-invalid={Boolean($errors.inviteCode)}
            aria-describedby={$errors.inviteCode ? "inviteCode-error" : undefined}
          />
          {#if $errors.inviteCode}<p
              id="inviteCode-error"
              class="mt-1 text-xs text-destructive"
            >
              {$errors.inviteCode}
            </p>{/if}
          <p class="mt-1 text-xs text-muted-foreground">
            {m.contestCreate_inviteCodeHint()}
          </p>
        </div>
      {/if}

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CodeIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.contestCreate_allowedLanguages()}</span>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">{m.contestCreate_allowedLanguagesHint()}</p>
        <div
          class="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label={m.contestCreate_allowedLanguages()}
          aria-describedby={$errors.allowedLanguages ? "allowedLanguages-error" : undefined}
        >
          {#each supportedLanguages as lang (lang)}
            {@const checked = ($form.allowedLanguages ?? []).includes(lang)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-body-sm font-medium transition-colors {checked
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-[color:var(--color-panel)] text-foreground hover:border-border-strong'}"
              onclick={() => toggleLanguage(lang)}
              aria-pressed={checked}
            >
              {lang}
            </button>
          {/each}
        </div>
        {#if $errors.allowedLanguages}<p
            id="allowedLanguages-error"
            class="mt-1 text-xs text-destructive"
          >
            {$errors.allowedLanguages}
          </p>{/if}
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ListIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.contestCreate_problemIds()}</span>
      </div>
      <ProblemPicker
        candidateProblems={data.candidateProblems}
        problemIds={selectedProblemIds}
        onProblemIdsChange={updateProblemIds}
        showSelected={false}
      />
      <div class="space-y-2">
        <div class="text-right text-caption text-muted-foreground">
          {m.common_dragToReorder()}
        </div>
        {#each $form.problems as problem, i (i)}
          {#if problem.problemId}
            {@const selectedProblem = candidateProblemById.get(problem.problemId)}
            <div
              role="listitem"
              class="flex items-center gap-2 rounded-md border px-2 py-1 {dragOverIndex === i
                ? 'border-primary bg-primary/5'
                : 'border-transparent'}"
              ondragover={(event) => handleDragOver(event, i)}
              ondrop={(event) => handleDrop(event, i)}
            >
              <span
                class="cursor-grab text-muted-foreground active:cursor-grabbing"
                draggable="true"
                role="button"
                tabindex="0"
                aria-label={m.common_dragToReorder()}
                ondragstart={(event) => handleDragStart(event, i)}
                ondragend={handleDragEnd}
                onkeydown={(event) => handleHandleKeydown(event, i)}
              >
                <GripVertical class="size-4" aria-hidden="true" />
              </span>
              <span
                class="w-6 shrink-0 text-center font-mono text-sm font-semibold text-muted-foreground"
              >
                {problemLetter(i + 1)}
              </span>
              <div
                class="min-w-0 flex-1 rounded-md border border-border bg-background px-3.5 py-2.5"
              >
                <div class="truncate text-body-sm font-medium">
                  {selectedProblem?.title ?? problem.problemId}
                </div>
                <div class="font-mono text-caption text-muted-foreground">
                  {selectedProblem?.displayId == null
                    ? m.common_problemDraft()
                    : `#${selectedProblem.displayId}`}
                </div>
              </div>
              {#if showPointsInput}
                <input
                  class="{inputClassName} w-24 shrink-0"
                  type="number"
                  min="1"
                  step="1"
                  bind:value={$form.problems[i]!.points}
                  aria-label={m.contestCreate_problemPointsLabel()}
                />
              {/if}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="hover:bg-transparent"
                onclick={() => removeProblem(i)}
                aria-label={m.contestCreate_problemRemove()}
                title={m.contestCreate_problemRemove()}
              >
                <Trash2 aria-hidden="true" class="size-4" />
              </Button>
            </div>
          {/if}
        {/each}
        {#if typeof $errors.problems === "string" || Array.isArray($errors.problems)}
          <p class="mt-1 text-xs text-destructive">{m.contestCreate_problemsInvalid()}</p>
        {/if}
      </div>

      <Button type="submit" size="lg" loading={$submitting}>
        <TrophyIcon aria-hidden="true" class="h-4 w-4" />
        {m.contestCreate_button()}
      </Button>
    </form>
  </Card>
</PageContainer>
