<script lang="ts">
  import { untrack } from "svelte";
  import { ChevronRight, Info } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { minutesToHHMM, hhmmToMinutes } from "$lib/utils/attempt-reset-time";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import LatePenaltyRuleBuilder, {
    type LatePenaltyRule,
  } from "$lib/components/features/course/LatePenaltyRuleBuilder.svelte";
  import StepCard from "$lib/components/features/coursework/StepCard.svelte";
  import ExamProblemPicker from "$lib/components/features/course/exam/ExamProblemPicker.svelte";
  import type { FormMessage } from "$lib/types/form-message";
  import { toggleArrayItem } from "$lib/utils";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting,
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    { dataType: "json", resetForm: false },
  );

  let advancedOpen = $state(true);

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function handleLatePenaltyChange(value: LatePenaltyRule) {
    $form.latePenalty = value;
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  const courseId = $derived(data.form.data.courseId ?? "");
</script>

<PageContainer width="form">
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

    <StepCard
      number={1}
      title={m.assignmentCreate_basicsTitle()}
      subtitle={m.assignmentCreate_basicsSubtitle()}
    >
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
    </StepCard>

    <StepCard
      number={2}
      title={m.assignmentCreate_problemsTitle()}
      subtitle={m.assignmentCreate_problemsSubtitle()}
    >
      <div data-tour="assignment-picker">
        <ExamProblemPicker
          candidateProblems={data.candidateProblems ?? []}
          bind:problemIds={$form.problemIds}
          error={$errors.problemIds}
        />
      </div>

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
    </StepCard>

    <StepCard
      number={3}
      title={m.assignmentCreate_scheduleTitle()}
      subtitle={m.assignmentCreate_scheduleSubtitle()}
      required
    >
      <div class="grid gap-5 md:grid-cols-3" data-tour="assignment-schedule">
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
    </StepCard>

    <div
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
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

          <div>
            <label class="text-body-sm font-medium" for="attemptResetTime">
              {m.assignmentDetail_settingsResetTimeLabel()}
            </label>
            <input
              id="attemptResetTime"
              type="time"
              value={minutesToHHMM($form.attemptResetMinuteOfDay)}
              oninput={(e) =>
                ($form.attemptResetMinuteOfDay = hhmmToMinutes(e.currentTarget.value))}
              class="mt-2 {inputClass} max-w-[200px]"
            />
            <input
              type="hidden"
              name="attemptResetMinuteOfDay"
              value={$form.attemptResetMinuteOfDay ?? 300}
            />
            <p class="mt-1 text-caption text-muted-foreground">
              {m.assignmentDetail_settingsResetTimeDesc()}
            </p>
          </div>

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

    <input type="hidden" name="courseId" value={$form.courseId} />

    <div
      class="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-6"
    >
      <span class="mr-auto text-caption text-muted-foreground">
        {m.assignmentCreate_hintDraftTaVisible()}
      </span>
      <Button href={`/courses/${courseId}/assignments`} variant="ghost">
        {m.assignmentCreate_cancel()}
      </Button>
      <Button type="submit" variant="outline" formaction="?/saveDraft" disabled={$submitting}>
        {m.assignmentCreate_saveDraft()}
      </Button>
      <Button
        type="submit"
        formaction="?/publish"
        disabled={$submitting}
        data-tour="assignment-publish"
      >
        {m.assignmentCreate_publish()}
      </Button>
    </div>
  </form>
</PageContainer>
