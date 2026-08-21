<script lang="ts">
  import { untrack } from "svelte";
  import { ChevronRight } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { minutesToHHMM, hhmmToMinutes } from "$lib/utils/attempt-reset-time";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import LatePenaltyRuleBuilder, {
    type LatePenaltyRule,
  } from "$lib/components/features/course/LatePenaltyRuleBuilder.svelte";
  import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";
  import ProblemPicker from "$lib/components/features/course/exam/ProblemPicker.svelte";
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
  let attemptsEnabled = $state(untrack(() => data.form.data.maxAttemptsPerDay != null));

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function handleLatePenaltyChange(value: LatePenaltyRule) {
    $form.latePenalty = value;
  }

  function toggleAttempts() {
    attemptsEnabled = !attemptsEnabled;
    if (!attemptsEnabled) {
      $form.maxAttemptsPerDay = undefined;
      $form.attemptResetMinuteOfDay = undefined;
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

  const courseId = $derived(data.form.data.courseId ?? "");

  function scheduleFieldLabel(field: "opensAt" | "dueAt" | "closesAt"): string {
    if (field === "opensAt") return m.assignmentCreate_opensLabel();
    if (field === "dueAt") return m.assignmentCreate_dueLabel();
    return m.assignmentCreate_finalDayLabel();
  }

  function scheduleError(error: unknown, field: "opensAt" | "dueAt" | "closesAt") {
    const raw = Array.isArray(error) ? error[0] : error;
    if (typeof raw !== "string" || !raw) return null;
    if (raw.includes("dueAt must be later than opensAt")) {
      return m.assignmentCreate_scheduleDueAfterOpen();
    }
    if (raw.includes("closesAt must be later than or equal to dueAt")) {
      return m.assignmentCreate_scheduleFinalAfterDue();
    }
    if (raw.includes("Too small") || raw.includes("expected")) {
      return m.assignmentCreate_scheduleRequired({ field: scheduleFieldLabel(field) });
    }
    return m.assignmentCreate_scheduleInvalid({ field: scheduleFieldLabel(field) });
  }
</script>

<PageContainer width="form">
  <form method="POST" use:enhance class="animate-in animate-in-1 space-y-6">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <div
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
    >
      <div class="mb-6">
        <h2 class="text-title-sm font-medium tracking-[-0.01em]">
          {m.assignmentCreate_basicsTitle()}
        </h2>
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

      <section class="mt-8 border-t border-border-subtle pt-6">
        <div class="mb-6">
          <h2 class="text-title-sm font-medium tracking-[-0.01em]">
            {m.assignmentCreate_problemsTitle()}
          </h2>
        </div>
        <div data-tour="assignment-picker">
          <ProblemPicker
            candidateProblems={data.candidateProblems}
            bind:problemIds={$form.problemIds}
            error={$errors.problemIds}
          />
        </div>
      </section>

      <section class="mt-8 border-t border-border-subtle pt-6">
        <div class="mb-6">
          <h2 class="text-title-sm font-medium tracking-[-0.01em]">
            {m.assignmentCreate_scheduleTitle()} <span class="text-destructive">*</span>
          </h2>
        </div>
        <div class="grid gap-5 md:grid-cols-3" data-tour="assignment-schedule">
          <div>
            <label class="text-body-sm font-medium" for="opensAt">
              {m.assignmentCreate_opensLabel()}
              <HelpTooltip text={m.assignmentCreate_opensHint()} />
            </label>
            <input
              id="opensAt"
              name="opensAt"
              type="datetime-local"
              bind:value={$form.opensAt}
              class="mt-2 {inputClass}"
            />
            {#if scheduleError($errors.opensAt, "opensAt")}
              <p class="mt-1 text-caption text-destructive">
                {scheduleError($errors.opensAt, "opensAt")}
              </p>
            {/if}
          </div>
          <div>
            <label class="text-body-sm font-medium" for="dueAt">
              {m.assignmentCreate_dueLabel()}
              <HelpTooltip text={m.assignmentCreate_dueHint()} />
            </label>
            <input
              id="dueAt"
              name="dueAt"
              type="datetime-local"
              bind:value={$form.dueAt}
              class="mt-2 {inputClass}"
            />
            {#if scheduleError($errors.dueAt, "dueAt")}
              <p class="mt-1 text-caption text-destructive">
                {scheduleError($errors.dueAt, "dueAt")}
              </p>
            {/if}
          </div>
          <div>
            <label class="text-body-sm font-medium" for="closesAt">
              {m.assignmentCreate_finalDayLabel()}
              <HelpTooltip text={m.assignmentCreate_finalDayHint()} />
            </label>
            <input
              id="closesAt"
              name="closesAt"
              type="datetime-local"
              bind:value={$form.closesAt}
              class="mt-2 {inputClass}"
            />
            {#if scheduleError($errors.closesAt, "closesAt")}
              <p class="mt-1 text-caption text-destructive">
                {scheduleError($errors.closesAt, "closesAt")}
              </p>
            {/if}
          </div>
        </div>
      </section>

      <section class="mt-8 border-t border-border-subtle pt-6">
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
          </div>
        </button>

        {#if advancedOpen}
          <div class="mt-6 space-y-6 border-t border-border-subtle pt-6">
            <label class="flex items-center gap-2 text-body-sm font-medium">
              <input type="checkbox" checked={attemptsEnabled} onchange={toggleAttempts} />
              {m.assignmentCreate_attemptsToggle()}
            </label>

            <div>
              <label class="text-body-sm font-medium" for="allowedLanguages">
                {m.assignmentCreate_languagesLabel()}
              </label>
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

            <div class="grid gap-6 md:grid-cols-2 {attemptsEnabled ? '' : 'opacity-50'}">
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
                  disabled={!attemptsEnabled}
                  class="mt-2 {inputClass} max-w-[200px] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                />
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
                  disabled={!attemptsEnabled}
                  class="mt-2 {inputClass} max-w-[200px] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                />
                <input
                  type="hidden"
                  name="attemptResetMinuteOfDay"
                  value={$form.attemptResetMinuteOfDay ?? 300}
                  disabled={!attemptsEnabled}
                />
              </div>
            </div>

            <div>
              <label class="text-body-sm font-medium" for="late-penalty-rule">
                {m.assignmentCreate_latePenaltyLabel()}
              </label>
              <LatePenaltyRuleBuilder
                value={$form.latePenalty as LatePenaltyRule}
                onChange={handleLatePenaltyChange}
              />
            </div>
          </div>
        {/if}
      </section>
    </div>

    <input type="hidden" name="courseId" value={$form.courseId} />

    <div
      class="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-6"
    >
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
