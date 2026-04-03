<script lang="ts">
  import { superForm } from "sveltekit-superforms";
  import * as Select from "$lib/components/ui/select";
  import { m } from "$lib/paraglide/messages.js";
  import { inputClassName } from "$lib/utils";
  import HelpTooltip from "$lib/components/ui/HelpTooltip.svelte";
  import ProblemTabs from "$lib/components/problem/ProblemTabs.svelte";

  let { data } = $props();

  const { form, errors, submitting, enhance } = superForm(data.form);

  const validationMessages: Record<string, () => string> = {
    validation_required: m.validation_required,
    validation_tooLong: m.validation_tooLong,
    validation_timeLimitMin: m.validation_timeLimitMin,
    validation_timeLimitMax: m.validation_timeLimitMax
  };

  function tr(err: string[] | undefined): string {
    if (!err?.length) return "";
    return validationMessages[err[0]]?.() ?? err[0];
  }

  let showAdvanced = $state(false);
  const disabledTabs = ["submission", "testcase", "judge", "scoring"];
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.problems_createNew()}
  </h2>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <ProblemTabs {disabledTabs}>
      {#snippet basic()}
        <form class="grid gap-4" method="POST" action="?/create" use:enhance>
          <!-- Title -->
          <label class="text-sm text-muted-foreground">
            <span>{m.admin_title()} <span class="text-red-500">*</span></span>
            <input
              class={inputClassName}
              name="title"
              bind:value={$form.title}
              required
            />
            {#if $errors.title)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.title)}</span>{/if}
          </label>

          <!-- Difficulty + Visibility -->
          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-1.5">
              <span class="text-sm text-muted-foreground">{m.admin_difficulty()} <span class="text-red-500">*</span></span>
              <Select.Root type="single" name="difficulty" value={$form.difficulty} onValueChange={(v) => { $form.difficulty = v; }}>
                <Select.Trigger class="w-full">
                  {({ easy: m.admin_difficultyEasy, medium: m.admin_difficultyMedium, hard: m.admin_difficultyHard } as Record<string, () => string>)[$form.difficulty]?.() ?? $form.difficulty}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="easy" label={m.admin_difficultyEasy()}>{m.admin_difficultyEasy()}</Select.Item>
                  <Select.Item value="medium" label={m.admin_difficultyMedium()}>{m.admin_difficultyMedium()}</Select.Item>
                  <Select.Item value="hard" label={m.admin_difficultyHard()}>{m.admin_difficultyHard()}</Select.Item>
                </Select.Content>
              </Select.Root>
              {#if $errors.difficulty)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.difficulty)}</span>{/if}
            </div>
            <div class="space-y-1.5">
              <span class="text-sm text-muted-foreground">{m.admin_visibility()} <span class="text-red-500">*</span> <HelpTooltip text={m.admin_helpVisibility()} /></span>
              <Select.Root type="single" name="visibility" value={$form.visibility} onValueChange={(v) => { $form.visibility = v; }}>
                <Select.Trigger class="w-full">
                  {({ private: m.admin_visibilityPrivate, public: m.admin_visibilityPublic } as Record<string, () => string>)[$form.visibility]?.() ?? $form.visibility}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="private" label={m.admin_visibilityPrivate()}>{m.admin_visibilityPrivate()}</Select.Item>
                  <Select.Item value="public" label={m.admin_visibilityPublic()}>{m.admin_visibilityPublic()}</Select.Item>
                </Select.Content>
              </Select.Root>
              {#if $errors.visibility)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.visibility)}</span>{/if}
            </div>
          </div>

          <!-- Statement -->
          <label class="text-sm text-muted-foreground">
            <span>{m.admin_statement()} <span class="text-red-500">*</span> <HelpTooltip text={m.admin_statementTooltip()} /></span>
            <textarea
              class="{inputClassName} min-h-40 resize-y"
              name="statement"
              bind:value={$form.statement}
              required
            ></textarea>
            {#if $errors.statement)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.statement)}</span>{/if}
          </label>

          <!-- Input/Output Format -->
          <div class="grid gap-4 md:grid-cols-2">
            <label class="text-sm text-muted-foreground">
              <span>{m.admin_inputFormat()} <span class="text-red-500">*</span> <HelpTooltip text={m.admin_inputFormatTooltip()} /></span>
              <textarea
                class="{inputClassName} min-h-20 resize-y"
                name="inputFormat"
                bind:value={$form.inputFormat}
                required
              ></textarea>
              {#if $errors.inputFormat)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.inputFormat)}</span>{/if}
            </label>
            <label class="text-sm text-muted-foreground">
              <span>{m.admin_outputFormat()} <span class="text-red-500">*</span> <HelpTooltip text={m.admin_outputFormatTooltip()} /></span>
              <textarea
                class="{inputClassName} min-h-20 resize-y"
                name="outputFormat"
                bind:value={$form.outputFormat}
                required
              ></textarea>
              {#if $errors.outputFormat)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.outputFormat)}</span>{/if}
            </label>
          </div>

          <!-- Advanced Options -->
          <button
            type="button"
            class="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
            onclick={() => (showAdvanced = !showAdvanced)}
          >
            {showAdvanced ? "▾" : "▸"} {m.admin_advancedOptions()}
          </button>
          {#if showAdvanced}
            <div class="grid gap-4">
              <label class="text-sm text-muted-foreground">
                <span>{m.admin_slug()} <HelpTooltip text={m.admin_slugTooltip()} /></span>
                <input
                  class={inputClassName}
                  name="slug"
                  bind:value={$form.slug}
                  placeholder={m.admin_slugPlaceholder()}
                />
                {#if $errors.slug)}<span class="text-sm text-red-700 dark:text-red-400">{tr($errors.slug)}</span>{/if}
              </label>
              <label class="text-sm text-muted-foreground">
                <span>{m.admin_summaryLabel()} <HelpTooltip text={m.admin_summaryTooltip()} /></span>
                <textarea
                  class="{inputClassName} min-h-20 resize-y"
                  name="summary"
                  bind:value={$form.summary}
                ></textarea>
              </label>
            </div>
          {/if}

          <!-- Submit -->
          <div class="mt-2 flex justify-end">
            <button
              class="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={$submitting}
              type="submit"
            >
              {#if $submitting}
                {m.common_saving()}
              {:else}
                {m.admin_saveBasicInfo()}
              {/if}
            </button>
          </div>
        </form>
      {/snippet}
    </ProblemTabs>
  </section>
</div>
