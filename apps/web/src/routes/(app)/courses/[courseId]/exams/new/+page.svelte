<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms/client";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Search from "@lucide/svelte/icons/search";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import Lock from "@lucide/svelte/icons/lock";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Shield from "@lucide/svelte/icons/shield";

  import { supportedLanguages, type Language } from "@nojv/core";
  import { Button } from "$lib/components/ui/button";
  import FormError from "$lib/components/ui/FormError.svelte";
  import { inputClassName, toggleArrayItem } from "$lib/utils";
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
    submitting
  } = superForm<typeof data.form.data, FormMessage>(untrack(() => data.form), {
    dataType: "json",
    resetForm: false
  });

  let advancedOpen = $state(false);
  let problemSearch = $state("");

  const filteredProblems = $derived.by(() => {
    const needle = problemSearch.trim().toLowerCase();
    const selected = new Set($form.problemIds);
    const pool = data.candidateProblems.filter((p) => !selected.has(p.id));
    if (!needle) return pool.slice(0, 12);
    return pool
      .filter((p) => {
        if (p.title.toLowerCase().includes(needle)) return true;
        if (p.id.toLowerCase().includes(needle)) return true;
        return p.tags.some((tag) => tag.toLowerCase().includes(needle));
      })
      .slice(0, 12);
  });

  const selectedDetails = $derived.by(() => {
    const lookup = new Map(data.candidateProblems.map((p) => [p.id, p]));
    return $form.problemIds
      .map((id) => lookup.get(id))
      .filter((p): p is (typeof data.candidateProblems)[number] => p !== undefined);
  });

  function addProblem(id: string) {
    if ($form.problemIds.includes(id)) return;
    $form.problemIds = [...$form.problemIds, id];
  }

  function removeProblem(id: string) {
    $form.problemIds = $form.problemIds.filter((pid) => pid !== id);
  }

  function moveProblem(id: string, delta: -1 | 1) {
    const next = [...$form.problemIds];
    const index = next.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    $form.problemIds = next;
  }

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  function difficultyClass(difficulty: string): string {
    if (difficulty === "easy") return "text-success";
    if (difficulty === "medium") return "text-warning";
    if (difficulty === "hard") return "text-destructive";
    return "text-muted-foreground";
  }
</script>

<div class="space-y-6 pb-20">
  <!-- Page head -->
  <section class="animate-in space-y-2">
    <a
      class="inline-flex items-center gap-1 text-body-sm text-muted-foreground no-underline hover:text-foreground"
      href={`/courses/${courseId}/exams`}
    >
      <ChevronLeft class="h-4 w-4" />
      {m.examCreate_breadcrumb()}
    </a>
    <h1 class="font-display text-title-lg">{m.examCreate_title()}</h1>
    <p class="text-body-sm text-muted-foreground">{m.examCreate_subtitle()}</p>
  </section>

  {#if $formMessage?.kind === "success"}
    <p class="text-body-sm text-success">{$formMessage.text}</p>
  {/if}

  <form method="POST" use:enhance class="animate-in animate-in-1 space-y-5">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <!-- Hidden courseId carrier -->
    <input type="hidden" name="courseId" value={$form.courseId} />

    <!-- ── Card 1 · Basics ───────────────────────────────── -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-display text-caption font-semibold text-background"
          >1</span
        >
        <div>
          <h2 class="font-display text-title-sm font-medium">
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

    <!-- ── Card 2 · Problems ─────────────────────────────── -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-display text-caption font-semibold text-background"
          >2</span
        >
        <div>
          <h2 class="font-display text-title-sm font-medium">
            {m.examCreate_problemsCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_problemsCardSubtitle()}
          </p>
        </div>
      </header>

      <!-- Picker -->
      <div class="rounded-lg border border-border bg-[color:var(--color-panel)]/60">
        <div
          class="flex items-center gap-2.5 border-b border-border px-4 py-2.5"
        >
          <Search class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            class="flex-1 bg-transparent text-body-sm outline-none"
            placeholder={m.examCreate_problemSearchPlaceholder()}
            bind:value={problemSearch}
          />
          <span class="text-caption text-muted-foreground">
            {m.examCreate_problemSearchCount({ count: filteredProblems.length })}
          </span>
        </div>
        <div class="max-h-56 overflow-y-auto p-1.5">
          {#each filteredProblems as problem (problem.id)}
            <button
              type="button"
              class="flex w-full items-center gap-3.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
              onclick={() => addProblem(problem.id)}
            >
              <span class="min-w-[96px] font-mono text-caption text-muted-foreground">
                {problem.id.slice(0, 14)}
              </span>
              <span class="flex-1 text-body-sm font-medium">{problem.title}</span>
              <span
                class="text-micro font-semibold uppercase tracking-[0.08em] {difficultyClass(
                  problem.difficulty
                )}"
              >
                {problem.difficulty}
              </span>
              <span
                class="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-muted-foreground"
              >
                <Plus class="h-3.5 w-3.5" />
              </span>
            </button>
          {:else}
            <p class="px-3 py-6 text-center text-body-sm text-muted-foreground">
              {m.examCreate_problemSearchEmpty()}
            </p>
          {/each}
        </div>
      </div>

      <!-- Selected -->
      {#if selectedDetails.length > 0}
        <div class="mt-4">
          <div
            class="flex items-center justify-between px-1 pb-2 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            <span
              >{m.examCreate_selectedProblemsCount({
                count: selectedDetails.length
              })}</span
            >
            <span>{m.examCreate_selectedProblemsReorderHint()}</span>
          </div>
          <div class="space-y-2">
            {#each selectedDetails as problem, index (problem.id)}
              <div
                class="flex items-center gap-4 rounded-md border border-border bg-[color:var(--color-panel)] px-4 py-3 transition-colors hover:border-border-strong"
              >
                <span
                  class="font-display text-title-sm text-muted-foreground min-w-[20px] text-center"
                  >{index + 1}</span
                >
                <div class="min-w-0 flex-1">
                  <div class="truncate text-body-sm font-medium">{problem.title}</div>
                  <div class="font-mono text-caption text-muted-foreground">
                    {problem.id}
                  </div>
                </div>
                <span
                  class="text-micro font-semibold uppercase tracking-[0.08em] {difficultyClass(
                    problem.difficulty
                  )}"
                >
                  {problem.difficulty}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={index === 0}
                    onclick={() => moveProblem(problem.id, -1)}
                    aria-label={m.examCreate_moveUp()}
                  >
                    <ChevronLeft class="h-3.5 w-3.5 rotate-90" />
                  </button>
                  <button
                    type="button"
                    class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    disabled={index === selectedDetails.length - 1}
                    onclick={() => moveProblem(problem.id, 1)}
                    aria-label={m.examCreate_moveDown()}
                  >
                    <ChevronRight class="h-3.5 w-3.5 rotate-90" />
                  </button>
                </div>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-[color:var(--color-destructive)]/8 hover:text-destructive"
                  onclick={() => removeProblem(problem.id)}
                  aria-label={m.examCreate_removeProblem()}
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <p
          class="mt-4 rounded-md border border-dashed border-info/30 bg-[color:var(--color-info)]/5 px-4 py-3 text-body-sm text-muted-foreground"
        >
          {m.examCreate_problemsEmptyHint()}
        </p>
      {/if}

      {#if $errors.problemIds}
        <p class="mt-2 text-xs text-destructive">{$errors.problemIds}</p>
      {/if}
    </section>

    <!-- ── Card 3 · Schedule ─────────────────────────────── -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-display text-caption font-semibold text-background"
          >3</span
        >
        <div>
          <h2 class="font-display text-title-sm font-medium">
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
        <div>
          <label class="text-sm font-medium" for="frozenAt">
            {m.examCreate_freezeLabel()}
          </label>
          <input
            id="frozenAt"
            class={inputClassName}
            type="datetime-local"
            bind:value={$form.frozenAt}
          />
          <p class="mt-1 text-caption text-muted-foreground">
            {m.examCreate_freezeHint()}
          </p>
        </div>
      </div>
    </section>

    <!-- ── Card 4 · Advanced (collapsible) ───────────────── -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur"
    >
      <button
        type="button"
        class="flex w-full items-center gap-3 text-left"
        onclick={() => (advancedOpen = !advancedOpen)}
        aria-expanded={advancedOpen}
      >
        <ChevronRight
          class="h-4 w-4 transition-transform {advancedOpen ? 'rotate-90' : ''}"
        />
        <div>
          <h2 class="font-display text-title-sm font-medium">
            {m.examCreate_advancedCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_advancedCardSubtitle()}
          </p>
        </div>
      </button>

      {#if advancedOpen}
        <div class="mt-6 border-t border-border pt-6">
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

    <!-- ── Card 5 · Proctoring ───────────────────────────── -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-display text-caption font-semibold text-background"
          >5</span
        >
        <div>
          <h2 class="font-display text-title-sm font-medium">
            {m.examCreate_proctoringCardTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.examCreate_proctoringCardSubtitle()}
          </p>
        </div>
      </header>

      <div class="space-y-3">
        <!-- Page lock -->
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
            <p
              class="mt-1 text-caption leading-relaxed text-muted-foreground"
            >
              {m.examCreate_pageLockDesc()}
            </p>
          </div>
          <label class="flex cursor-pointer items-center">
            <input
              type="checkbox"
              class="peer sr-only"
              bind:checked={$form.pageLockEnabled}
            />
            <span
              class="relative mt-2 block h-5 w-10 flex-shrink-0 rounded-full border border-border bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary"
              aria-hidden="true"
            >
              <span
                class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]"
              ></span>
            </span>
          </label>
        </div>

        <!-- IP binding -->
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
              <p
                class="mt-1 text-caption leading-relaxed text-muted-foreground"
              >
                {m.examCreate_ipBindingDesc()}
              </p>
            </div>
            <label class="flex cursor-pointer items-center">
              <input
                type="checkbox"
                class="peer sr-only"
                bind:checked={$form.ipBindingEnabled}
              />
              <span
                class="relative mt-2 block h-5 w-10 flex-shrink-0 rounded-full border border-border bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary"
                aria-hidden="true"
              >
                <span
                  class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]"
                ></span>
              </span>
            </label>
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

        <!-- IP whitelist -->
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
              <p
                class="mt-1 text-caption leading-relaxed text-muted-foreground"
              >
                {m.examCreate_ipWhitelistDesc()}
                <span class="text-warning">
                  {m.examCreate_ipWhitelistWarning()}
                </span>
              </p>
            </div>
            <label class="flex cursor-pointer items-center">
              <input
                type="checkbox"
                class="peer sr-only"
                bind:checked={$form.ipWhitelistEnabled}
              />
              <span
                class="relative mt-2 block h-5 w-10 flex-shrink-0 rounded-full border border-border bg-muted transition-colors peer-checked:border-primary peer-checked:bg-primary"
                aria-hidden="true"
              >
                <span
                  class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]"
                ></span>
              </span>
            </label>
          </div>

          {#if $form.ipWhitelistEnabled}
            <div
              class="mt-3.5 rounded-r-md border-l-[3px] border-primary bg-[color:var(--color-primary)]/4 px-4 py-3.5"
            >
              <label class="text-sm font-medium" for="ipWhitelistText">
                {m.examCreate_ipWhitelistCidrLabel()}
              </label>
              <textarea
                id="ipWhitelistText"
                class="{inputClassName} mt-2 min-h-24 resize-y font-mono"
                placeholder={m.examCreate_ipWhitelistPlaceholder()}
                bind:value={$form.ipWhitelistText}
              ></textarea>
            </div>
          {/if}
        </div>
      </div>
    </section>

    <!-- ── Card 6 · Scoring ──────────────────────────────── -->
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur"
    >
      <header class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-display text-caption font-semibold text-background"
          >6</span
        >
        <div>
          <h2 class="font-display text-title-sm font-medium">
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
            <select
              id="scoringMode"
              class={inputClassName}
              bind:value={$form.scoringMode}
            >
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

    <!-- ── Actions ───────────────────────────────────────── -->
    <div
      class="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-6"
    >
      <span class="mr-auto text-caption text-muted-foreground">
        {m.examCreate_actionsHint()}
      </span>
      <Button variant="ghost" href={`/courses/${courseId}/exams`} disabled={$submitting}>
        {m.examCreate_cancel()}
      </Button>
      <Button
        type="submit"
        variant="outline"
        formaction="?/saveDraft"
        disabled={$submitting}
      >
        {m.examCreate_saveDraft()}
      </Button>
      <Button type="submit" formaction="?/publish" disabled={$submitting}>
        {m.examCreate_publish()}
      </Button>
    </div>
  </form>
</div>
