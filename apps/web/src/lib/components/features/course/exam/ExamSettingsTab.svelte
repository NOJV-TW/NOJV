<script lang="ts" module>
  import type { examDomain } from "@nojv/application";
  import type { ExamSettingsForm } from "@nojv/core";

  export type SettingsTabDetail = examDomain.ExamDetailPage;
  export type SettingsLiveStatus = "draft" | "upcoming" | "running" | "ended";
  export type { ExamSettingsForm };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Send from "@lucide/svelte/icons/send";

  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import { cn } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";
  import type { FormMessage } from "$lib/types/form-message";
  import ExamBasicSettings from "./settings/ExamBasicSettings.svelte";
  import ExamTimelineConfig from "./settings/ExamTimelineConfig.svelte";
  import ExamProblemConfig from "./settings/ExamProblemConfig.svelte";
  import ExamProctoringConfig from "./settings/ExamProctoringConfig.svelte";

  interface Props {
    form: SuperValidated<ExamSettingsForm, FormMessage>;
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
    submitting,
  } = superForm<ExamSettingsForm, FormMessage>(
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
  const editableProctoring = $derived(isDraft || isUpcoming || isRunning);
  const editableScoring = $derived(isDraft || isUpcoming);

  function lockHint(): string | null {
    if (isRunning) return m.examDetail_settingsLockHintRunning();
    if (isEnded) return m.examDetail_settingsLockHintEnded();
    return null;
  }

  let confirmingDelete = $state(false);

  const lockMsg = $derived(lockHint());
</script>

<section data-slot="exam-settings-tab" class={cn("space-y-6", className)}>
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

    <ExamBasicSettings {form} {errors} editable={editableBasics} />

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
    >
      <h3 class="mb-4 text-title-sm font-medium">
        {m.examDetail_settingsSectionBasic()}
      </h3>
      <ExamTimelineConfig
        {form}
        {errors}
        editableStart={editableBasics}
        editableEnd={editableBasics || isRunning}
        {isRunning}
      />
    </section>

    <ExamProblemConfig {form} {errors} editable={editableScoring} />

    <ExamProctoringConfig {form} editable={editableProctoring} />

    {#if confirmingDelete}
      <div class="flex flex-wrap items-center justify-end gap-2">
        <span class="mr-auto text-caption text-muted-foreground">
          {m.examDetail_settingsDeleteConfirmBody()}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={$submitting}
          onclick={() => (confirmingDelete = false)}
        >
          {m.examDetail_settingsDeleteConfirmCancel()}
        </Button>
        <Button
          type="submit"
          formaction="?/deleteExam"
          variant="destructive"
          size="sm"
          disabled={$submitting}
        >
          <Trash2 class="mr-1 size-4" aria-hidden="true" />
          {m.examDetail_settingsDeleteConfirmConfirm()}
        </Button>
      </div>
    {:else}
      <div class="flex flex-wrap items-center justify-end gap-2">
        {#if isDraft}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="mr-auto text-destructive hover:text-destructive"
            disabled={$submitting}
            onclick={() => (confirmingDelete = true)}
          >
            <Trash2 class="mr-1 size-4" aria-hidden="true" />
            {m.examDetail_settingsDeleteButton()}
          </Button>
        {/if}

        <Button type="submit" variant="default" size="sm" disabled={$submitting || isEnded}>
          {m.examDetail_settingsSaveButton()}
        </Button>

        {#if isDraft}
          <Button
            type="submit"
            formaction="?/publishExam"
            variant="default"
            size="sm"
            disabled={$submitting}
          >
            <Send class="mr-1 size-4" aria-hidden="true" />
            {m.examDetail_settingsPublishButton()}
          </Button>
        {/if}
      </div>
    {/if}
  </form>
</section>
