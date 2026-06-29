<script lang="ts" module>
  import type { ContestSettingsForm } from "@nojv/core";

  export type { ContestSettingsForm };
  export type ContestLiveStatus = "draft" | "upcoming" | "running" | "ended";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { enhance as kitEnhance } from "$app/forms";
  import Send from "@lucide/svelte/icons/send";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import XIcon from "@lucide/svelte/icons/x";

  import { supportedLanguages, type Language } from "@nojv/core";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";
  import {
    contestScoringOptions,
    contestScoringModeHelp,
    contestModeUsesPoints,
  } from "$lib/utils/contest-scoring";
  import { cn, inputClassName } from "$lib/utils/css";
  import { toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import type { FormMessage } from "$lib/types/form-message";

  interface Props {
    form: SuperValidated<ContestSettingsForm, FormMessage>;
    liveStatus: ContestLiveStatus;
    class?: string;
  }

  let { form: formProp, liveStatus, class: className }: Props = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting,
  } = superForm<ContestSettingsForm, FormMessage>(
    untrack(() => formProp),
    {
      dataType: "json",
      resetForm: false,
      invalidateAll: true,
    },
  );

  const isDraft = $derived(liveStatus === "draft");
  const isUpcoming = $derived(liveStatus === "upcoming");
  const isRunning = $derived(liveStatus === "running");
  const isEnded = $derived(liveStatus === "ended");

  const editableBasics = $derived(isDraft || isUpcoming);
  const editableScoring = $derived(isDraft || isUpcoming);
  const showPointsInput = $derived(contestModeUsesPoints($form.scoringMode));

  function toggleLanguage(lang: Language) {
    if (!editableScoring) return;
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function addProblem() {
    $form.problems = [...$form.problems, { problemId: "", points: 100 }];
  }

  function removeProblem(index: number) {
    $form.problems = $form.problems.filter((_, i) => i !== index);
  }

  function lockHint(): string | null {
    if (isRunning) return m.contestDetail_settingsLockHintRunning();
    if (isEnded) return m.contestDetail_settingsLockHintEnded();
    return null;
  }

  const lockMsg = $derived(lockHint());
</script>

<section data-slot="contest-settings-tab" class={cn("space-y-6", className)}>
  <header>
    <h2 class="text-title font-medium leading-tight">
      {m.contestDetail_settingsHeading()}
    </h2>
    <p class="mt-1 text-caption text-muted-foreground">
      {m.contestDetail_settingsHint()}
    </p>
  </header>

  {#if lockMsg}
    <div
      role="note"
      class="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-body-sm text-warning"
    >
      {lockMsg}
    </div>
  {/if}

  {#if $formMessage?.kind === "success"}
    <p class="text-body-sm text-success">{$formMessage.text}</p>
  {/if}

  <form method="POST" action="?/updateSettings" use:enhance class="space-y-5">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.contestDetail_settingsSectionBasic()}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium" for="contest-settings-title">
            {m.contestDetail_settingsTitleLabel()}
          </label>
          <input
            id="contest-settings-title"
            class={inputClassName}
            type="text"
            bind:value={$form.title}
            disabled={!editableBasics}
            aria-invalid={$errors.title ? "true" : undefined}
          />
          {#if $errors.title}
            <p class="mt-1 text-xs text-destructive">{$errors.title}</p>
          {/if}
        </div>

        <div>
          <label class="text-sm font-medium" for="contest-settings-summary">
            {m.contestDetail_settingsSummaryLabel()}
          </label>
          <textarea
            id="contest-settings-summary"
            class="{inputClassName} min-h-24 resize-y"
            bind:value={$form.summary}
            disabled={!editableBasics}></textarea>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <label class="text-sm font-medium" for="contest-settings-starts">
              {m.contestDetail_settingsStartsLabel()}
            </label>
            <input
              id="contest-settings-starts"
              class={inputClassName}
              type="datetime-local"
              bind:value={$form.startsAt}
              disabled={!editableBasics}
            />
            {#if $errors.startsAt}
              <p class="mt-1 text-xs text-destructive">{$errors.startsAt}</p>
            {/if}
          </div>
          <div>
            <label class="text-sm font-medium" for="contest-settings-ends">
              {m.contestDetail_settingsEndsLabel()}
            </label>
            <input
              id="contest-settings-ends"
              class={inputClassName}
              type="datetime-local"
              bind:value={$form.endsAt}
              disabled={!editableBasics && !isRunning}
            />
            {#if $errors.endsAt}
              <p class="mt-1 text-xs text-destructive">{$errors.endsAt}</p>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.contestDetail_settingsSectionScoring()}
      </h3>
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <label
              class="flex items-center gap-1.5 text-sm font-medium"
              for="contest-settings-scoringMode"
            >
              {m.contestDetail_settingsScoringModeLabel()}
              <HelpTooltip text={contestScoringModeHelp()} nowrap />
            </label>
            <select
              id="contest-settings-scoringMode"
              class={inputClassName}
              bind:value={$form.scoringMode}
              disabled={!editableScoring}
            >
              {#each contestScoringOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label()}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="text-sm font-medium" for="contest-settings-scoreboardMode">
              {m.contestDetail_settingsScoreboardModeLabel()}
            </label>
            <select
              id="contest-settings-scoreboardMode"
              class={inputClassName}
              bind:value={$form.scoreboardMode}
              disabled={!editableScoring}
            >
              <option value="live">{m.contestDetail_scoreboardLive()}</option>
              <option value="frozen">{m.contestDetail_scoreboardFrozen()}</option>
              <option value="hidden">{m.contestDetail_scoreboardHidden()}</option>
            </select>
          </div>
        </div>

        <div>
          <div class="text-sm font-medium">{m.contestCreate_problemIds()}</div>
          <div class="mt-2 space-y-2">
            {#each $form.problems as problem, i (i)}
              <div class="flex items-center gap-2">
                <span
                  class="w-6 shrink-0 text-center font-mono text-sm font-semibold text-muted-foreground"
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <input
                  class={inputClassName}
                  type="text"
                  placeholder={m.contestCreate_problemIdsPlaceholder()}
                  bind:value={$form.problems[i]!.problemId}
                  disabled={!editableScoring}
                  aria-label={m.contestCreate_problemIds()}
                />
                {#if showPointsInput}
                  <input
                    class="{inputClassName} w-24 shrink-0"
                    type="number"
                    min="1"
                    step="1"
                    bind:value={$form.problems[i]!.points}
                    disabled={!editableScoring}
                    aria-label={m.contestCreate_problemPointsLabel()}
                  />
                {/if}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!editableScoring || $form.problems.length <= 1}
                  onclick={() => removeProblem(i)}
                  aria-label={m.contestCreate_problemRemove()}
                >
                  <XIcon aria-hidden="true" class="h-4 w-4" />
                </Button>
              </div>
            {/each}
            {#if editableScoring}
              <Button type="button" variant="outline" size="sm" onclick={addProblem}>
                <PlusIcon aria-hidden="true" class="h-4 w-4" />
                {m.contestCreate_problemAdd()}
              </Button>
            {/if}
          </div>
        </div>

        <div>
          <div class="text-sm font-medium">
            {m.contestDetail_settingsLanguagesLabel()}
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each supportedLanguages as lang (lang)}
              {@const checked = ($form.allowedLanguages ?? []).includes(lang)}
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-body-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 {checked
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-[color:var(--color-panel)] text-foreground hover:border-border-strong'}"
                onclick={() => toggleLanguage(lang)}
                aria-pressed={checked}
                disabled={!editableScoring}
              >
                {lang}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <label class="text-sm font-medium" for="contest-settings-cooldown">
            {m.contestDetail_settingsCooldownLabel()}
          </label>
          <input
            id="contest-settings-cooldown"
            class={inputClassName}
            type="number"
            min="0"
            max="3600"
            bind:value={$form.submitCooldownSec}
            disabled={!editableScoring}
          />
          {#if $errors.submitCooldownSec}
            <p class="mt-1 text-xs text-destructive">{$errors.submitCooldownSec}</p>
          {/if}
        </div>

        <div>
          <label class="text-sm font-medium" for="contest-settings-penalty">
            {m.contestDetail_settingsPenaltyMinutesLabel()}
          </label>
          <input
            id="contest-settings-penalty"
            class={inputClassName}
            type="number"
            min="0"
            max="1440"
            bind:value={$form.penaltyMinutesPerWrong}
            disabled={!editableScoring}
          />
          <p class="mt-1 text-xs text-muted-foreground">
            {m.contestDetail_settingsPenaltyMinutesHint()}
          </p>
          {#if $errors.penaltyMinutesPerWrong}
            <p class="mt-1 text-xs text-destructive">{$errors.penaltyMinutesPerWrong}</p>
          {/if}
        </div>

        <div>
          <label class="text-sm font-medium" for="contest-settings-freeze">
            {m.contestDetail_settingsFreezeLabel()}
          </label>
          <input
            id="contest-settings-freeze"
            class={inputClassName}
            type="datetime-local"
            bind:value={$form.frozenAt}
            disabled={!editableScoring}
          />
          <p class="mt-1 text-xs text-muted-foreground">
            {m.contestDetail_settingsFreezeHint()}
          </p>
          {#if $errors.frozenAt}
            <p class="mt-1 text-xs text-destructive">{$errors.frozenAt}</p>
          {/if}
        </div>
      </div>
    </section>

    <div class="flex items-center justify-end gap-2">
      <Button type="submit" variant="default" size="sm" disabled={$submitting || isEnded}>
        {m.contestDetail_settingsSaveButton()}
      </Button>
    </div>
  </form>

  <section
    class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
  >
    <h3 class="mb-4 text-title-sm font-medium">
      {m.contestDetail_settingsSectionLifecycle()}
    </h3>

    <div class="flex flex-wrap items-center gap-3">
      {#if isDraft}
        <form method="POST" action="?/publishContest" use:kitEnhance class="contents">
          <Button type="submit" size="sm" variant="default" disabled={$submitting}>
            <Send class="mr-1 size-4" aria-hidden="true" />
            {m.contestDetail_settingsPublishButton()}
          </Button>
        </form>
        <form method="POST" action="?/deleteContest" use:kitEnhance class="contents">
          <Button type="submit" size="sm" variant="destructive" disabled={$submitting}>
            <Trash2 class="mr-1 size-4" aria-hidden="true" />
            {m.contestDetail_settingsDeleteButton()}
          </Button>
        </form>
      {/if}

      {#if isUpcoming || isRunning}
        <span class="text-caption text-muted-foreground">
          {m.contestDetail_settingsLifecycleNoop()}
        </span>
      {/if}
    </div>
  </section>
</section>
