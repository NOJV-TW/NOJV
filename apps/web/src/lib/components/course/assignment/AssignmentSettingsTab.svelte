<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";
  import type { AssessmentSettingsFormData } from "@nojv/core";

  export type SettingsTabDetail = courseDomain.AssignmentDetail;
  export type SettingsLiveStatus =
    | "draft"
    | "upcoming"
    | "open"
    | "closed"
    | "archived";
  export type { AssessmentSettingsFormData };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import Archive from "@lucide/svelte/icons/archive";
  import Send from "@lucide/svelte/icons/send";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Undo2 from "@lucide/svelte/icons/undo-2";

  import { supportedLanguages, type Language } from "@nojv/core";
  import { Button } from "$lib/components/ui/button";
  import FormError from "$lib/components/ui/FormError.svelte";
  import { cn, inputClassName, toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import type { FormMessage } from "$lib/types/form-message";

  interface Props {
    form: SuperValidated<AssessmentSettingsFormData, FormMessage>;
    detail: SettingsTabDetail;
    liveStatus: SettingsLiveStatus;
    class?: string;
  }

  let { form: formProp, detail: _detail, liveStatus, class: className }: Props = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting
  } = superForm<AssessmentSettingsFormData, FormMessage>(
    untrack(() => formProp),
    {
      dataType: "json",
      resetForm: false,
      invalidateAll: true
    }
  );

  // Status-aware field locks. The server re-validates; these flags keep
  // the UI honest so students/TAs don't waste a round-trip fiddling with
  // a locked field.
  const isDraft = $derived(liveStatus === "draft");
  const isUpcoming = $derived(liveStatus === "upcoming");
  const isOpen = $derived(liveStatus === "open");
  const isClosed = $derived(liveStatus === "closed");
  const isArchived = $derived(liveStatus === "archived");

  // Basic fields (title / summary / languages / attempts / cooldown /
  // scoring): editable while the assignment hasn't ended.
  const editableBasics = $derived(isDraft || isUpcoming || isOpen);
  // opensAt locks once the assignment opens.
  const editableOpensAt = $derived(isDraft || isUpcoming);
  // dueAt / closesAt: free-form in draft/upcoming, delay-only while open.
  const editableDeadlines = $derived(isDraft || isUpcoming || isOpen);

  function toggleLanguage(lang: Language) {
    if (!editableBasics) return;
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function lockHint(): string | null {
    if (isOpen) return m.assignmentDetail_settingsLockHintOpen();
    if (isClosed) return m.assignmentDetail_settingsLockHintClosed();
    if (isArchived) return m.assignmentDetail_settingsLockHintArchived();
    return null;
  }

  const lockMsg = $derived(lockHint());

  let confirmingDelete = $state(false);
</script>

<section data-slot="assignment-settings-tab" class={cn("space-y-6", className)}>
  <header class="flex items-baseline justify-between gap-4">
    <div>
      <h2 class="text-title font-medium leading-tight">
        {m.assignmentDetail_settingsHeading()}
      </h2>
      <p class="mt-1 text-caption text-muted-foreground">
        {m.assignmentDetail_settingsHint()}
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
    <p class="text-body-sm text-success">
      {m.assignmentDetail_settingsSaveSuccess()}
    </p>
  {/if}

  <form method="POST" action="?/updateSettings" use:enhance class="space-y-5">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <section
      class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.assignmentDetail_settingsSectionBasic()}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium" for="settings-title">
            {m.assignmentDetail_settingsTitleLabel()}
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
            {m.assignmentDetail_settingsSummaryLabel()}
          </label>
          <textarea
            id="settings-summary"
            class="{inputClassName} min-h-24 resize-y"
            bind:value={$form.summary}
            disabled={!editableBasics}
          ></textarea>
        </div>

        <div class="grid gap-4 md:grid-cols-3">
          <div>
            <label class="text-sm font-medium" for="settings-opens">
              {m.assignmentDetail_settingsOpensLabel()}
            </label>
            <input
              id="settings-opens"
              class={inputClassName}
              type="datetime-local"
              bind:value={$form.opensAt}
              disabled={!editableOpensAt}
            />
            {#if $errors.opensAt}
              <p class="mt-1 text-xs text-destructive">{$errors.opensAt}</p>
            {/if}
          </div>
          <div>
            <label class="text-sm font-medium" for="settings-due">
              {m.assignmentDetail_settingsDueLabel()}
            </label>
            <input
              id="settings-due"
              class={inputClassName}
              type="datetime-local"
              bind:value={$form.dueAt}
              disabled={!editableDeadlines}
            />
            {#if $errors.dueAt}
              <p class="mt-1 text-xs text-destructive">{$errors.dueAt}</p>
            {/if}
          </div>
          <div>
            <label class="text-sm font-medium" for="settings-closes">
              {m.assignmentDetail_settingsClosesLabel()}
            </label>
            <input
              id="settings-closes"
              class={inputClassName}
              type="datetime-local"
              bind:value={$form.closesAt}
              disabled={!editableDeadlines}
            />
            {#if $errors.closesAt}
              <p class="mt-1 text-xs text-destructive">{$errors.closesAt}</p>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <section
      class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.assignmentDetail_settingsSectionSubmission()}
      </h3>
      <div class="space-y-4">
        <div>
          <div class="text-sm font-medium">
            {m.assignmentDetail_settingsLanguagesLabel()}
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
                disabled={!editableBasics}
              >
                {lang}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <label class="text-sm font-medium" for="settings-maxAttempts">
            {m.assignmentDetail_settingsMaxAttemptsLabel()}
          </label>
          <input
            id="settings-maxAttempts"
            class={inputClassName}
            type="number"
            min="1"
            max="999"
            placeholder={m.assignmentDetail_settingsMaxAttemptsPlaceholder()}
            bind:value={$form.maxAttemptsPerDay}
            disabled={!editableBasics}
          />
          {#if $errors.maxAttemptsPerDay}
            <p class="mt-1 text-xs text-destructive">{$errors.maxAttemptsPerDay}</p>
          {/if}
        </div>
      </div>
    </section>

    <div class="flex items-center justify-end gap-2">
      <Button
        type="submit"
        variant="default"
        size="sm"
        disabled={$submitting || isClosed || isArchived}
      >
        {m.assignmentDetail_settingsSaveButton()}
      </Button>
    </div>
  </form>

  <section
    class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest"
  >
    <h3 class="mb-4 text-title-sm font-medium">
      {m.assignmentDetail_settingsSectionLifecycle()}
    </h3>

    <div class="flex flex-wrap items-center gap-3">
      {#if isDraft}
        <form method="POST" action="?/publishAssessment" use:enhance class="contents">
          <Button type="submit" size="sm" variant="default" disabled={$submitting}>
            <Send class="mr-1 size-4" aria-hidden="true" />
            {m.assignmentDetail_settingsPublishButton()}
          </Button>
        </form>
      {/if}

      {#if isUpcoming}
        <form method="POST" action="?/revertToDraft" use:enhance class="contents">
          <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
            <Undo2 class="mr-1 size-4" aria-hidden="true" />
            {m.assignmentDetail_settingsRevertToDraftButton()}
          </Button>
        </form>
      {/if}

      {#if isClosed || liveStatus === "open"}
        <!-- Managers can archive a published-but-ended (closed) assignment.
             Open assignments aren't archived directly — they must close
             first; the button is hidden until `isClosed`. -->
        {#if isClosed}
          <form method="POST" action="?/archiveAssessment" use:enhance class="contents">
            <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
              <Archive class="mr-1 size-4" aria-hidden="true" />
              {m.assignmentDetail_settingsArchiveButton()}
            </Button>
          </form>
        {/if}
      {/if}

      {#if isArchived}
        <form method="POST" action="?/unarchiveAssessment" use:enhance class="contents">
          <Button type="submit" size="sm" variant="outline" disabled={$submitting}>
            <Archive class="mr-1 size-4" aria-hidden="true" />
            {m.assignmentDetail_settingsUnarchiveButton()}
          </Button>
        </form>
      {/if}
    </div>
  </section>

  <!-- Danger zone (delete, drafts only) -->
  {#if isDraft}
    <section
      class="space-y-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] px-6 py-5"
    >
      <div class="flex items-baseline gap-2">
        <AlertTriangle class="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <h4 class="text-body-lg font-medium text-destructive">
          {m.assignmentDetail_settingsDangerZone()}
        </h4>
      </div>

      {#if !confirmingDelete}
        <div class="flex items-center justify-between gap-4">
          <p class="text-caption text-muted-foreground">
            {m.assignmentDetail_settingsDeleteConfirmBody()}
          </p>
          <Button
            variant="destructive"
            size="sm"
            type="button"
            onclick={() => (confirmingDelete = true)}
          >
            <Trash2 class="mr-1 size-4" aria-hidden="true" />
            {m.assignmentDetail_settingsDeleteButton()}
          </Button>
        </div>
      {:else}
        <div
          class="rounded-md border border-destructive/40 bg-destructive/[0.06] px-4 py-3"
        >
          <div class="font-semibold text-destructive">
            {m.assignmentDetail_settingsDeleteConfirmTitle()}
          </div>
          <p class="mt-1 text-caption text-muted-foreground">
            {m.assignmentDetail_settingsDeleteConfirmBody()}
          </p>
          <div class="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={() => (confirmingDelete = false)}
              disabled={$submitting}
            >
              {m.assignmentDetail_settingsDeleteConfirmCancel()}
            </Button>
            <form method="POST" action="?/deleteAssessment" use:enhance class="contents">
              <Button type="submit" variant="destructive" size="sm" disabled={$submitting}>
                {m.assignmentDetail_settingsDeleteConfirmConfirm()}
              </Button>
            </form>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</section>
