<script lang="ts">
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import type { ProblemCreate, ProblemDifficulty, ProblemVisibility } from "@nojv/core";
  import * as Select from "$lib/components/primitives/ui/select";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils/css";
  import TagSelect from "$lib/components/primitives/ui/TagSelect.svelte";
  import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";
  import ImageDropZone from "$lib/components/primitives/ui/ImageDropZone.svelte";
  import SamplesEditor from "$lib/components/features/problem/statement/SamplesEditor.svelte";

  const textareaClassName = `${inputClassName} min-h-28 resize-y`;

  interface Props {
    formData: SuperValidated<ProblemCreate>;
    problemId: string;
    showRuntimeLimits?: boolean;
    ondirtychange?: (dirty: boolean) => void;
  }

  let { formData, problemId, showRuntimeLimits = false, ondirtychange }: Props = $props();

  let attempted = $state(false);

  const {
    form,
    errors,
    submitting,
    tainted,
    message: formMessage,
    enhance,
  } = superForm(
    untrack(() => formData),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: () => {
        attempted = true;
      },
    },
  );

  $effect(() => {
    const dirty = $tainted ? Object.values($tainted).some(Boolean) : false;
    ondirtychange?.(dirty);
  });

  let tags = $state<string[]>($form.tags ?? []);
  $effect(() => {
    $form.tags = tags;
  });

  let samples = $state<{ input: string; output: string }[]>($form.samples ?? []);
  $effect(() => {
    $form.samples = samples;
  });

  let showAdvanced = $state(false);

  const validationMessages: Record<string, () => string> = {
    validation_required: m.validation_required,
    validation_tooLong: m.validation_tooLong,
  };

  function tr(err: string[] | undefined): string {
    if (!err?.length) return "";
    const first = err[0] ?? "";
    return validationMessages[first]?.() ?? first;
  }

  const difficultyLabels: Record<string, () => string> = {
    easy: m.admin_difficultyEasy,
    medium: m.admin_difficultyMedium,
    hard: m.admin_difficultyHard,
  };

  const visibilityLabels: Record<string, () => string> = {
    private: m.admin_visibilityPrivate,
    public: m.admin_visibilityPublic,
  };
</script>

<form class="grid gap-4" method="POST" action="?/update" use:enhance>
  <label class="text-body-sm text-muted-foreground">
    <span>{m.admin_title()} <span class="text-destructive">*</span></span>
    <input class={inputClassName} name="title" bind:value={$form.title} required />
    {#if attempted && $errors.title}<span class="text-body-sm text-destructive"
        >{tr($errors.title)}</span
      >{/if}
  </label>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="space-y-1.5">
      <span class="text-body-sm text-muted-foreground"
        >{m.admin_difficulty()} <span class="text-destructive">*</span></span
      >
      <Select.Root
        type="single"
        name="difficulty"
        value={$form.difficulty}
        onValueChange={(v) => {
          $form.difficulty = v as ProblemDifficulty;
        }}
      >
        <Select.Trigger class="w-full">
          {difficultyLabels[$form.difficulty]?.() ?? $form.difficulty}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="easy" label={m.admin_difficultyEasy()}
            >{m.admin_difficultyEasy()}</Select.Item
          >
          <Select.Item value="medium" label={m.admin_difficultyMedium()}
            >{m.admin_difficultyMedium()}</Select.Item
          >
          <Select.Item value="hard" label={m.admin_difficultyHard()}
            >{m.admin_difficultyHard()}</Select.Item
          >
        </Select.Content>
      </Select.Root>
      {#if attempted && $errors.difficulty}<span class="text-body-sm text-destructive"
          >{tr($errors.difficulty)}</span
        >{/if}
    </div>
    <div class="space-y-1.5">
      <span class="text-body-sm text-muted-foreground"
        >{m.admin_visibility()} <span class="text-destructive">*</span>
        <HelpTooltip text={m.admin_helpVisibility()} /></span
      >
      <Select.Root
        type="single"
        name="visibility"
        value={$form.visibility}
        onValueChange={(v) => {
          $form.visibility = v as ProblemVisibility;
        }}
      >
        <Select.Trigger class="w-full">
          {visibilityLabels[$form.visibility]?.() ?? $form.visibility}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="private" label={m.admin_visibilityPrivate()}
            >{m.admin_visibilityPrivate()}</Select.Item
          >
          <Select.Item value="public" label={m.admin_visibilityPublic()}
            >{m.admin_visibilityPublic()}</Select.Item
          >
        </Select.Content>
      </Select.Root>
      {#if attempted && $errors.visibility}<span class="text-body-sm text-destructive"
          >{tr($errors.visibility)}</span
        >{/if}
    </div>
  </div>

  <label class="text-body-sm text-muted-foreground">
    <span
      >{m.admin_statement()} <span class="text-destructive">*</span>
      <HelpTooltip text={m.admin_statementTooltip()} /></span
    >
    <ImageDropZone
      class="{textareaClassName} min-h-40"
      name="statement"
      bind:value={$form.statement}
      {problemId}
      required
    />
    {#if attempted && $errors.statement}<span class="text-body-sm text-destructive"
        >{tr($errors.statement)}</span
      >{/if}
  </label>

  {#if showRuntimeLimits}
    <div class="grid gap-4 md:grid-cols-2">
      <label class="text-body-sm text-muted-foreground">
        <span>{m.admin_timeLimitMs()}</span>
        <input
          class={inputClassName}
          type="number"
          min="100"
          max="30000"
          bind:value={$form.timeLimitMs}
        />
      </label>
      <label class="text-body-sm text-muted-foreground">
        <span>{m.admin_memoryLimitMb()}</span>
        <input
          class={inputClassName}
          type="number"
          min="16"
          max="1024"
          bind:value={$form.memoryLimitMb}
        />
      </label>
    </div>
  {/if}

  <div class="grid gap-4 md:grid-cols-2">
    <label class="text-body-sm text-muted-foreground">
      <span
        >{m.admin_inputFormat()} <span class="text-destructive">*</span>
        <HelpTooltip text={m.admin_inputFormatTooltip()} /></span
      >
      <ImageDropZone
        class={textareaClassName}
        name="inputFormat"
        bind:value={$form.inputFormat}
        {problemId}
        required
      />
      {#if attempted && $errors.inputFormat}<span class="text-body-sm text-destructive"
          >{tr($errors.inputFormat)}</span
        >{/if}
    </label>
    <label class="text-body-sm text-muted-foreground">
      <span
        >{m.admin_outputFormat()} <span class="text-destructive">*</span>
        <HelpTooltip text={m.admin_outputFormatTooltip()} /></span
      >
      <ImageDropZone
        class={textareaClassName}
        name="outputFormat"
        bind:value={$form.outputFormat}
        {problemId}
        required
      />
      {#if attempted && $errors.outputFormat}<span class="text-body-sm text-destructive"
          >{tr($errors.outputFormat)}</span
        >{/if}
    </label>
  </div>

  <SamplesEditor bind:samples />

  <button
    type="button"
    class="text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground text-left"
    onclick={() => (showAdvanced = !showAdvanced)}
  >
    {showAdvanced ? "▾" : "▸"}
    {m.admin_advancedOptions()}
  </button>
  {#if showAdvanced}
    <div class="grid gap-4">
      <div class="text-body-sm text-muted-foreground">
        <span>{m.admin_tags()}</span>
        <div class="mt-2">
          <TagSelect bind:tags placeholder={m.admin_tagsPlaceholder()} />
        </div>
      </div>
    </div>
  {/if}

  <div class="mt-2 flex items-center justify-end gap-3">
    <button
      class="inline-flex rounded-full bg-primary px-5 py-3 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={$submitting}
      type="submit"
    >
      {#if $submitting}
        {m.common_saving()}
      {:else}
        {m.common_saveDraft()}
      {/if}
    </button>
    {#if $formMessage}
      <span class="text-body-sm text-success">{m.common_saved()}</span>
    {/if}
  </div>
</form>
