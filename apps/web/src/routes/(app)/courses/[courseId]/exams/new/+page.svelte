<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms/client";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Lock from "@lucide/svelte/icons/lock";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Shield from "@lucide/svelte/icons/shield";

  import { supportedLanguages, type Language } from "@nojv/core";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import ToggleSwitch from "$lib/components/primitives/ui/ToggleSwitch.svelte";
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import IpWhitelistField from "$lib/components/features/course/exam/IpWhitelistField.svelte";
  import ExamProblemPicker from "$lib/components/features/course/exam/ExamProblemPicker.svelte";
  import { inputClassName } from "$lib/utils/css";
  import { toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import type { FormMessage } from "$lib/types/form-message";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const courseId = $derived(data.form.data.courseId);

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting,
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    {
      dataType: "json",
      resetForm: false,
    },
  );

  let advancedOpen = $state(false);

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }
</script>

<PageContainer width="form" class="space-y-6">
  <PageHero
    variant="workspace"
    breadcrumbHref={`/courses/${courseId}/exams`}
    breadcrumbLabel={m.examCreate_breadcrumb()}
    eyebrow={m.examCreate_eyebrow()}
    title={m.examCreate_title()}
  />
  <p class="animate-in max-w-2xl text-body-sm text-muted-foreground">
    {m.examCreate_subtitle()}
  </p>

  {#if $formMessage?.kind === "success"}
    <p class="text-body-sm text-success">{$formMessage.text}</p>
  {/if}

  <form method="POST" use:enhance class="animate-in animate-in-1 space-y-5">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <input type="hidden" name="courseId" value={$form.courseId} />

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          >1</span
        >
        <div>
          <h2 class="text-title-sm font-medium">
            {m.examCreate_basicsCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_basicsCardSubtitle()}
          </p>
        </div>
      </header>

      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium" for="title">
            {m.examCreate_titleLabel()} <span class="text-destructive">*</span>
          </label>
          <input
            id="title"
            class={inputClassName}
            type="text"
            placeholder={m.examCreate_titlePlaceholder()}
            bind:value={$form.title}
            aria-invalid={$errors.title ? "true" : undefined}
          />
          {#if $errors.title}
            <p class="mt-1 text-xs text-destructive">{$errors.title}</p>
          {/if}
        </div>

        <div>
          <label class="text-sm font-medium" for="summary">
            {m.examCreate_summaryLabel()}
          </label>
          <textarea
            id="summary"
            class="{inputClassName} min-h-24 resize-y"
            placeholder={m.examCreate_summaryPlaceholder()}
            bind:value={$form.summary}
          ></textarea>
          {#if $errors.summary}
            <p class="mt-1 text-xs text-destructive">{$errors.summary}</p>
          {/if}
        </div>
      </div>
    </section>

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          >2</span
        >
        <div>
          <h2 class="text-title-sm font-medium">
            {m.examCreate_problemsCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_problemsCardSubtitle()}
          </p>
        </div>
      </header>

      <ExamProblemPicker
        candidateProblems={data.candidateProblems}
        bind:problemIds={$form.problemIds}
        error={$errors.problemIds}
      />
    </section>

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          >3</span
        >
        <div>
          <h2 class="text-title-sm font-medium">
            {m.examCreate_scheduleCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_scheduleCardSubtitle()}
          </p>
        </div>
      </header>

      <div class="grid gap-5 md:grid-cols-3">
        <div>
          <label class="text-sm font-medium" for="startsAt">
            {m.examCreate_startsLabel()} <span class="text-destructive">*</span>
          </label>
          <input
            id="startsAt"
            class={inputClassName}
            type="datetime-local"
            bind:value={$form.startsAt}
            aria-invalid={$errors.startsAt ? "true" : undefined}
          />
          {#if $errors.startsAt}
            <p class="mt-1 text-xs text-destructive">{$errors.startsAt}</p>
          {/if}
        </div>
        <div>
          <label class="text-sm font-medium" for="endsAt">
            {m.examCreate_endsLabel()} <span class="text-destructive">*</span>
          </label>
          <input
            id="endsAt"
            class={inputClassName}
            type="datetime-local"
            bind:value={$form.endsAt}
            aria-invalid={$errors.endsAt ? "true" : undefined}
          />
          {#if $errors.endsAt}
            <p class="mt-1 text-xs text-destructive">{$errors.endsAt}</p>
          {/if}
        </div>
      </div>
    </section>

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur"
    >
      <button
        type="button"
        class="flex w-full items-center gap-3 text-left"
        onclick={() => (advancedOpen = !advancedOpen)}
        aria-expanded={advancedOpen}
      >
        <ChevronRight
          aria-hidden="true"
          class="h-4 w-4 transition-transform {advancedOpen ? 'rotate-90' : ''}"
        />
        <div>
          <h2 class="text-title-sm font-medium">
            {m.examCreate_advancedCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_advancedCardSubtitle()}
          </p>
        </div>
      </button>

      {#if advancedOpen}
        <div class="mt-6 border-t border-border-subtle pt-6">
          <div>
            <span class="text-sm font-medium">{m.examCreate_languagesLabel()}</span>
            <p class="mt-1 text-caption text-muted-foreground">
              {m.examCreate_languagesHint()}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
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
          </div>
        </div>
      {/if}
    </section>

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          >5</span
        >
        <div>
          <h2 class="text-title-sm font-medium">
            {m.examCreate_proctoringCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_proctoringCardSubtitle()}
          </p>
        </div>
      </header>

      <div class="space-y-3">
        <div
          class="flex items-start justify-between gap-4 rounded-md border border-border bg-[color:var(--color-panel)] px-5 py-4.5 transition-colors {$form.pageLockEnabled
            ? 'border-[color:var(--color-primary)]/28'
            : ''}"
        >
          <span
            class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md transition-colors {$form.pageLockEnabled
              ? 'bg-[color:var(--color-primary)]/14 text-primary'
              : 'bg-muted text-muted-foreground'}"
          >
            <Lock class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="flex-1">
            <div class="font-semibold tracking-[-0.005em]">
              {m.examCreate_pageLockLabel()}
            </div>
            <p class="mt-1 text-caption leading-relaxed text-muted-foreground">
              {m.examCreate_pageLockDesc()}
            </p>
          </div>
          <ToggleSwitch bind:checked={$form.pageLockEnabled} />
        </div>

        <div
          class="rounded-md border border-border bg-[color:var(--color-panel)] px-5 py-4.5 transition-colors {$form.ipBindingEnabled
            ? 'border-[color:var(--color-primary)]/28'
            : ''}"
        >
          <div class="flex items-start justify-between gap-4">
            <span
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md transition-colors {$form.ipBindingEnabled
                ? 'bg-[color:var(--color-primary)]/14 text-primary'
                : 'bg-muted text-muted-foreground'}"
            >
              <Link2 class="h-5 w-5" aria-hidden="true" />
            </span>
            <div class="flex-1">
              <div class="font-semibold tracking-[-0.005em]">
                {m.examCreate_ipBindingLabel()}
              </div>
              <p class="mt-1 text-caption leading-relaxed text-muted-foreground">
                {m.examCreate_ipBindingDesc()}
              </p>
            </div>
            <ToggleSwitch bind:checked={$form.ipBindingEnabled} />
          </div>

          {#if $form.ipBindingEnabled}
            <div
              class="mt-3.5 rounded-r-md border-l-[3px] border-primary bg-[color:var(--color-primary)]/4 px-4 py-3.5"
            >
              <div class="text-sm font-medium">
                {m.examCreate_violationModeLabel()}
              </div>
              <div class="mt-2 flex gap-4">
                <label class="flex items-center gap-1.5 text-body-sm">
                  <input
                    type="radio"
                    name="ipViolationMode"
                    value="block"
                    checked={$form.ipViolationMode === "block"}
                    onchange={() => ($form.ipViolationMode = "block")}
                  />
                  {m.examCreate_violationBlock()}
                </label>
                <label class="flex items-center gap-1.5 text-body-sm">
                  <input
                    type="radio"
                    name="ipViolationMode"
                    value="notify"
                    checked={$form.ipViolationMode === "notify"}
                    onchange={() => ($form.ipViolationMode = "notify")}
                  />
                  {m.examCreate_violationNotify()}
                </label>
              </div>
            </div>
          {/if}
        </div>

        <div
          class="rounded-md border border-border bg-[color:var(--color-panel)] px-5 py-4.5 transition-colors {$form.ipWhitelistEnabled
            ? 'border-[color:var(--color-primary)]/28'
            : ''}"
        >
          <div class="flex items-start justify-between gap-4">
            <span
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md transition-colors {$form.ipWhitelistEnabled
                ? 'bg-[color:var(--color-primary)]/14 text-primary'
                : 'bg-muted text-muted-foreground'}"
            >
              <Shield class="h-5 w-5" aria-hidden="true" />
            </span>
            <div class="flex-1">
              <div class="font-semibold tracking-[-0.005em]">
                {m.examCreate_ipWhitelistLabel()}
              </div>
              <p class="mt-1 text-caption leading-relaxed text-muted-foreground">
                {m.examCreate_ipWhitelistDesc()}
                <span class="text-warning">
                  {m.examCreate_ipWhitelistWarning()}
                </span>
              </p>
            </div>
            <ToggleSwitch bind:checked={$form.ipWhitelistEnabled} />
          </div>

          {#if $form.ipWhitelistEnabled}
            <div
              class="mt-3.5 rounded-r-md border-l-[3px] border-primary bg-[color:var(--color-primary)]/4 px-4 py-3.5"
            >
              <IpWhitelistField
                id="ipWhitelistText"
                label={m.examCreate_ipWhitelistCidrLabel()}
                placeholder={m.examCreate_ipWhitelistPlaceholder()}
                bind:value={$form.ipWhitelistText}
                importLabel={m.examCreate_ipWhitelistImport()}
                fileTooLargeMessage={m.examCreate_ipWhitelistFileTooLarge()}
                ariaInvalid={$errors.ipWhitelistText ? "true" : undefined}
              />
              {#if $errors.ipWhitelistText}
                <p class="mt-1 text-xs text-destructive">{$errors.ipWhitelistText}</p>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </section>

    <section
      class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-caption font-semibold text-background"
          >6</span
        >
        <div>
          <h2 class="text-title-sm font-medium">
            {m.examCreate_scoringCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_scoringCardSubtitle()}
          </p>
        </div>
      </header>

      <div class="space-y-5">
        <div class="grid gap-5 md:grid-cols-2">
          <div>
            <label class="text-sm font-medium" for="scoringMode">
              {m.examCreate_scoringModeLabel()} <span class="text-destructive">*</span>
            </label>
            <select id="scoringMode" class={inputClassName} bind:value={$form.scoringMode}>
              <option value="problem_count">
                {m.examCreate_scoringModeProblemCount()}
              </option>
              <option value="point_sum">{m.examCreate_scoringModePointSum()}</option>
            </select>
          </div>
          <div>
            <label class="text-sm font-medium" for="scoreboardMode">
              {m.examCreate_scoreboardModeLabel()}
            </label>
            <select
              id="scoreboardMode"
              class={inputClassName}
              bind:value={$form.scoreboardMode}
            >
              <option value="live">{m.examCreate_scoreboardLive()}</option>
              <option value="frozen">{m.examCreate_scoreboardFrozen()}</option>
              <option value="hidden">{m.examCreate_scoreboardHidden()}</option>
            </select>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium" for="submitCooldownSec">
            {m.examCreate_cooldownLabel()}
          </label>
          <div class="mt-2 flex items-center gap-2">
            <input
              id="submitCooldownSec"
              class="{inputClassName} mt-0 flex-1"
              type="number"
              min="0"
              max="3600"
              bind:value={$form.submitCooldownSec}
            />
            <span class="text-body-sm text-muted-foreground">
              {m.examCreate_cooldownUnit()}
            </span>
          </div>
          <p class="mt-1 text-caption text-muted-foreground">
            {m.examCreate_cooldownDesc()}
          </p>
          {#if $errors.submitCooldownSec}
            <p class="mt-1 text-xs text-destructive">{$errors.submitCooldownSec}</p>
          {/if}
        </div>
      </div>
    </section>

    <div
      class="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-6"
    >
      <span class="mr-auto text-caption text-muted-foreground">
        {m.examCreate_actionsHint()}
      </span>
      <Button variant="ghost" href={`/courses/${courseId}/exams`} disabled={$submitting}>
        {m.examCreate_cancel()}
      </Button>
      <Button type="submit" variant="outline" formaction="?/saveDraft" disabled={$submitting}>
        {m.examCreate_saveDraft()}
      </Button>
      <Button type="submit" formaction="?/publish" disabled={$submitting}>
        {m.examCreate_publish()}
      </Button>
    </div>
  </form>
</PageContainer>
