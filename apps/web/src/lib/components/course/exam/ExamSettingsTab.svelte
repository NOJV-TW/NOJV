<script lang="ts" module>
  import type { examDomain } from "@nojv/domain";
  import type { ExamSettingsForm } from "@nojv/core";

  export type SettingsTabDetail = examDomain.ExamDetailPageData;
  export type SettingsLiveStatus = "draft" | "upcoming" | "running" | "ended" | "archived";
  export type { ExamSettingsForm };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import Archive from "@lucide/svelte/icons/archive";
  import Snowflake from "@lucide/svelte/icons/snowflake";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Send from "@lucide/svelte/icons/send";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";

  import { supportedLanguages, type Language } from "@nojv/core";
  import { Button } from "$lib/components/ui/button";
  import FormError from "$lib/components/ui/FormError.svelte";
  import { cn, inputClassName, monoTextareaClassName, toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import type { FormMessage } from "$lib/types/form-message";

  interface Props {
    form: SuperValidated<ExamSettingsForm, FormMessage>;
    detail: SettingsTabDetail;
    liveStatus: SettingsLiveStatus;
    class?: string;
  }

  let { form: formProp, detail, liveStatus, class: className }: Props = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting
  } = superForm<ExamSettingsForm, FormMessage>(untrack(() => formProp), {
    dataType: "json",
    resetForm: false,
    invalidateAll: true
  });

  // Field-lock rules per spec. Server re-validates; these flags only
  // hint to the UI which controls are safe to touch.
  const isDraft = $derived(liveStatus === "draft");
  const isUpcoming = $derived(liveStatus === "upcoming");
  const isRunning = $derived(liveStatus === "running");
  const isEnded = $derived(liveStatus === "ended");
  const isArchived = $derived(liveStatus === "archived");

  // Anything set in draft/upcoming is freely editable.
  const editableBasics = $derived(isDraft || isUpcoming);
  // Running phase keeps the proctoring escape hatches live; everything
  // else freezes.
  const editableProctoring = $derived(isDraft || isUpcoming || isRunning);
  // Scoring shape / cooldown / languages become immutable once any
  // student can submit.
  const editableScoring = $derived(isDraft || isUpcoming);

  function toggleLanguage(lang: Language) {
    if (!editableScoring) return;
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function lockHint(): string | null {
    if (isRunning) return m.examDetail_settingsLockHintRunning();
    if (isEnded) return m.examDetail_settingsLockHintEnded();
    if (isArchived) return m.examDetail_settingsLockHintArchived();
    return null;
  }

  let confirmingDelete = $state(false);

  const lockMsg = $derived(lockHint());
</script>

<section
  data-slot="exam-settings-tab"
  class={cn("space-y-6", className)}
>
  <header class="flex items-baseline justify-between gap-4">
    <div>
      <h2 class="text-title font-medium leading-tight">
        {m.examDetail_settingsHeading()}
      </h2>
      <p class="mt-1 text-caption text-muted-foreground">
        {m.examDetail_settingsHint()}
      </p>
    </div>
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

    <!-- Basic -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.examDetail_settingsSectionBasic()}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium" for="settings-title">
            {m.examDetail_settingsTitleLabel()}
          </label>
          <input
            id="settings-title"
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
          <label class="text-sm font-medium" for="settings-summary">
            {m.examDetail_settingsSummaryLabel()}
          </label>
          <textarea
            id="settings-summary"
            class="{inputClassName} min-h-24 resize-y"
            bind:value={$form.summary}
            disabled={!editableBasics}
          ></textarea>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <label class="text-sm font-medium" for="settings-starts">
              {m.examDetail_settingsStartsLabel()}
            </label>
            <input
              id="settings-starts"
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
            <label class="text-sm font-medium" for="settings-ends">
              {m.examDetail_settingsEndsLabel()}
            </label>
            <input
              id="settings-ends"
              class={inputClassName}
              type="datetime-local"
              bind:value={$form.endsAt}
              disabled={!editableBasics && !isRunning}
            />
            {#if $errors.endsAt}
              <p class="mt-1 text-xs text-destructive">{$errors.endsAt}</p>
            {/if}
            {#if isRunning}
              <p class="mt-1 text-caption text-muted-foreground">
                {m.examDetail_settingsEndsRunningHint()}
              </p>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <!-- Scoring -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.examDetail_settingsSectionScoring()}
      </h3>
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <label class="text-sm font-medium" for="settings-scoringMode">
              {m.examDetail_settingsScoringModeLabel()}
            </label>
            <select
              id="settings-scoringMode"
              class={inputClassName}
              bind:value={$form.scoringMode}
              disabled={!editableScoring}
            >
              <option value="problem_count">{m.examDetail_scoringProblemCount()}</option>
              <option value="point_sum">{m.examDetail_scoringPointSum()}</option>
            </select>
          </div>
          <div>
            <label class="text-sm font-medium" for="settings-scoreboardMode">
              {m.examDetail_settingsScoreboardModeLabel()}
            </label>
            <select
              id="settings-scoreboardMode"
              class={inputClassName}
              bind:value={$form.scoreboardMode}
              disabled={!editableScoring}
            >
              <option value="live">{m.examCreate_scoreboardLive()}</option>
              <option value="frozen">{m.examCreate_scoreboardFrozen()}</option>
              <option value="hidden">{m.examCreate_scoreboardHidden()}</option>
            </select>
          </div>
        </div>

        <div>
          <div class="text-sm font-medium">
            {m.examDetail_settingsLanguagesLabel()}
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
          <label class="text-sm font-medium" for="settings-cooldown">
            {m.examDetail_settingsCooldownLabel()}
          </label>
          <input
            id="settings-cooldown"
            class={inputClassName}
            type="number"
            min="0"
            max="600"
            bind:value={$form.submitCooldownSec}
            disabled={!editableScoring}
          />
          {#if $errors.submitCooldownSec}
            <p class="mt-1 text-xs text-destructive">{$errors.submitCooldownSec}</p>
          {/if}
        </div>
      </div>
    </section>

    <!-- Proctoring -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.examDetail_settingsSectionProctoring()}
      </h3>
      <div class="space-y-4">
        <label
          class="flex items-center gap-3 text-body-sm {editableProctoring
            ? ''
            : 'opacity-60'}"
        >
          <input
            type="checkbox"
            bind:checked={$form.pageLockEnabled}
            disabled={!editableProctoring}
          />
          {m.examDetail_settingsPageLockLabel()}
        </label>

        <label
          class="flex items-center gap-3 text-body-sm {editableProctoring
            ? ''
            : 'opacity-60'}"
        >
          <input
            type="checkbox"
            bind:checked={$form.ipBindingEnabled}
            disabled={!editableProctoring}
          />
          {m.examDetail_settingsIpBindingLabel()}
        </label>

        <label
          class="flex items-center gap-3 text-body-sm {editableProctoring
            ? ''
            : 'opacity-60'}"
        >
          <input
            type="checkbox"
            bind:checked={$form.ipWhitelistEnabled}
            disabled={!editableProctoring}
          />
          {m.examDetail_settingsIpWhitelistEnabledLabel()}
        </label>

        {#if $form.ipWhitelistEnabled}
          <div>
            <label class="text-sm font-medium" for="settings-ipWhitelist">
              {m.examDetail_settingsIpWhitelistLabel()}
            </label>
            <textarea
              id="settings-ipWhitelist"
              class={monoTextareaClassName}
              bind:value={$form.ipWhitelistText}
              disabled={!editableProctoring}
              placeholder="10.0.0.0/24&#10;192.168.1.5/32&#10;2001:db8::/32"
            ></textarea>
          </div>
        {/if}

        <div>
          <label class="text-sm font-medium" for="settings-ipViolationMode">
            {m.examDetail_settingsIpViolationModeLabel()}
          </label>
          <select
            id="settings-ipViolationMode"
            class={inputClassName}
            bind:value={$form.ipViolationMode}
            disabled={!editableProctoring}
          >
            <option value="block">{m.examCreate_violationBlock()}</option>
            <option value="notify">{m.examCreate_violationNotify()}</option>
          </select>
        </div>
      </div>
    </section>

    <div class="flex items-center justify-end gap-2">
      <Button
        type="submit"
        variant="default"
        size="sm"
        disabled={$submitting || isEnded || isArchived}
      >
        {m.examDetail_settingsSaveButton()}
      </Button>
    </div>
  </form>

  <!-- Lifecycle -->
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-6 shadow-rest"
  >
    <h3 class="mb-4 text-title-sm font-medium">
      {m.examDetail_settingsSectionLifecycle()}
    </h3>

    <div class="flex flex-wrap items-center gap-3">
      {#if isDraft}
        <form method="POST" action="?/publishExam" use:enhance class="contents">
          <Button type="submit" size="sm" variant="default" disabled={$submitting}>
            <Send class="mr-1 size-4" aria-hidden="true" />
            {m.examDetail_settingsPublishButton()}
          </Button>
        </form>
      {/if}

      {#if isRunning}
        {#if detail.manager?.frozenBoard}
          <form method="POST" action="?/unfreezeBoard" use:enhance class="contents">
            <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
              <Snowflake class="mr-1 size-4" aria-hidden="true" />
              {m.examDetail_settingsUnfreezeButton()}
            </Button>
          </form>
        {:else}
          <form method="POST" action="?/freezeBoard" use:enhance class="contents">
            <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
              <Snowflake class="mr-1 size-4" aria-hidden="true" />
              {m.examDetail_settingsFreezeButton()}
            </Button>
          </form>
        {/if}
      {/if}

      {#if isEnded}
        <form method="POST" action="?/archiveExam" use:enhance class="contents">
          <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
            <Archive class="mr-1 size-4" aria-hidden="true" />
            {m.examDetail_settingsArchiveButton()}
          </Button>
        </form>
      {/if}

      {#if isArchived}
        <form method="POST" action="?/unarchiveExam" use:enhance class="contents">
          <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
            <Archive class="mr-1 size-4" aria-hidden="true" />
            {m.examDetail_settingsUnarchiveButton()}
          </Button>
        </form>
      {/if}

      {#if !isDraft && !isRunning && !isEnded && !isArchived}
        <span class="text-caption text-muted-foreground">
          {m.examDetail_settingsLifecycleNoop()}
        </span>
      {/if}
    </div>
  </section>

  <!-- Danger zone (delete) -->
  {#if isDraft}
    <section
      class="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/[0.04] px-6 py-5"
    >
      <div class="flex items-baseline gap-2">
        <AlertTriangle class="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <h4 class="text-body-lg font-medium text-destructive">
          {m.examDetail_settingsDangerZone()}
        </h4>
      </div>

      {#if !confirmingDelete}
        <div class="flex items-center justify-between gap-4">
          <p class="text-caption text-muted-foreground">
            {m.examDetail_settingsDeleteConfirmBody()}
          </p>
          <Button
            variant="destructive"
            size="sm"
            type="button"
            onclick={() => (confirmingDelete = true)}
          >
            <Trash2 class="mr-1 size-4" aria-hidden="true" />
            {m.examDetail_settingsDeleteButton()}
          </Button>
        </div>
      {:else}
        <div
          class="rounded-md border border-destructive/40 bg-destructive/[0.06] px-4 py-3"
        >
          <div class="font-semibold text-destructive">
            {m.examDetail_settingsDeleteConfirmTitle()}
          </div>
          <p class="mt-1 text-caption text-muted-foreground">
            {m.examDetail_settingsDeleteConfirmBody()}
          </p>
          <div class="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={() => (confirmingDelete = false)}
              disabled={$submitting}
            >
              {m.examDetail_settingsDeleteConfirmCancel()}
            </Button>
            <form method="POST" action="?/deleteExam" use:enhance class="contents">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={$submitting}
              >
                {m.examDetail_settingsDeleteConfirmConfirm()}
              </Button>
            </form>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</section>
