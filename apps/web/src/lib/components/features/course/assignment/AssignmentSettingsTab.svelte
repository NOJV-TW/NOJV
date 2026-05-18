<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";
  import type { AssessmentSettingsFormData } from "@nojv/core";

  export type SettingsTabDetail = courseDomain.AssignmentDetail;
  export type SettingsLiveStatus = "draft" | "upcoming" | "open" | "closed";
  export type { AssessmentSettingsFormData };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";

  import { supportedLanguages, type Language } from "@nojv/core";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import { cn, inputClassName } from "$lib/utils/css";
  import { toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import type { FormMessage } from "$lib/types/form-message";
  import AssignmentLifecycleSection from "./AssignmentLifecycleSection.svelte";
  import AssignmentBasicSection from "./AssignmentBasicSection.svelte";
  import LatePenaltyRuleBuilder, {
    type LatePenaltyRule,
  } from "$lib/components/features/course/LatePenaltyRuleBuilder.svelte";

  interface Props {
    form: SuperValidated<AssessmentSettingsFormData, FormMessage>;
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
    return null;
  }

  const lockMsg = $derived(lockHint());
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

    <AssignmentBasicSection
      {form}
      {errors}
      {editableBasics}
      {editableOpensAt}
      {editableDeadlines}
    />

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

        <fieldset disabled={!editableBasics} class="m-0 min-w-0 border-0 p-0">
          <div class="text-sm font-medium">{m.assignmentCreate_latePenaltyLabel()}</div>
          <p class="mt-1 mb-3 text-caption text-muted-foreground">
            {m.assignmentCreate_latePenaltyDesc()}
          </p>
          <LatePenaltyRuleBuilder
            value={$form.latePenalty as LatePenaltyRule}
            onChange={(value) => ($form.latePenalty = value)}
          />
        </fieldset>
      </div>
    </section>

    <div class="flex items-center justify-end gap-2">
      <Button
        type="submit"
        variant="default"
        size="sm"
        disabled={$submitting || isClosed}
      >
        {m.assignmentDetail_settingsSaveButton()}
      </Button>
    </div>
  </form>

  <AssignmentLifecycleSection
    {isDraft}
    {isUpcoming}
    submitting={$submitting}
    {enhance}
    auditLog={detail.auditLog}
  />
</section>
