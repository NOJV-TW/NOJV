<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { inputClassName, toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import CodeIcon from "@lucide/svelte/icons/code";
  import LinkIcon from "@lucide/svelte/icons/link";
  import ListIcon from "@lucide/svelte/icons/list";

  let { data } = $props();

  const { form, errors, enhance, message: formMessage } = superForm(untrack(() => data.form), {
    resetForm: false
  });

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }
</script>

<div class="space-y-6">
  <div class="flex items-center gap-3">
    <TrophyIcon class="h-8 w-8 text-primary" />
    <h2 class="font-[family-name:var(--font-display)] text-3xl">{m.contestCreate_title()}</h2>
  </div>

  {#if $formMessage}
    <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
      {$formMessage}
    </div>
  {/if}

  <form method="POST" action="?/create" use:enhance class="space-y-5 max-w-2xl">
    <div>
      <label class="text-sm font-medium" for="slug">{m.contestCreate_slug()}</label>
      <input
        class={inputClassName}
        id="slug"
        name="slug"
        type="text"
        placeholder={m.contestCreate_slugPlaceholder()}
        bind:value={$form.slug}
      />
      {#if $errors.slug}<p class="mt-1 text-xs text-red-600">{$errors.slug}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="title">{m.contestCreate_titleField()}</label>
      <input
        class={inputClassName}
        id="title"
        name="title"
        type="text"
        placeholder={m.contestCreate_titlePlaceholder()}
        bind:value={$form.title}
      />
      {#if $errors.title}<p class="mt-1 text-xs text-red-600">{$errors.title}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="summary">{m.contestCreate_summary()}</label>
      <textarea
        class="{inputClassName} min-h-24 resize-y"
        id="summary"
        name="summary"
        placeholder={m.contestCreate_summaryPlaceholder()}
        bind:value={$form.summary}
      ></textarea>
      {#if $errors.summary}<p class="mt-1 text-xs text-red-600">{$errors.summary}</p>{/if}
    </div>

    <!-- Time -->
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <ClockIcon class="h-4 w-4" />
      <span>{m.common_timeline()}</span>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="text-sm font-medium" for="startsAt">{m.contestCreate_startsAt()}</label>
        <input
          class={inputClassName}
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          bind:value={$form.startsAt}
        />
        {#if $errors.startsAt}<p class="mt-1 text-xs text-red-600">{$errors.startsAt}</p>{/if}
      </div>
      <div>
        <label class="text-sm font-medium" for="endsAt">{m.contestCreate_endsAt()}</label>
        <input
          class={inputClassName}
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          bind:value={$form.endsAt}
        />
        {#if $errors.endsAt}<p class="mt-1 text-xs text-red-600">{$errors.endsAt}</p>{/if}
      </div>
    </div>

    <!-- Scoring -->
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <SettingsIcon class="h-4 w-4" />
      <span>{m.contestCreate_scoringMode()}</span>
    </div>
    <div>
      <label class="text-sm font-medium" for="scoringMode">{m.contestCreate_scoringMode()}</label>
      <select class={inputClassName} id="scoringMode" name="scoringMode" bind:value={$form.scoringMode}>
        <option value="icpc">ICPC (AC + penalty)</option>
        <option value="ioi">IOI (best score per problem)</option>
      </select>
    </div>

    <div>
      <label class="text-sm font-medium" for="submitCooldownSec">{m.contestCreate_submitCooldown()}</label>
      <input
        class={inputClassName}
        id="submitCooldownSec"
        name="submitCooldownSec"
        type="number"
        min="0"
        max="3600"
        bind:value={$form.submitCooldownSec}
      />
      {#if $errors.submitCooldownSec}<p class="mt-1 text-xs text-red-600">{$errors.submitCooldownSec}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="scoreboardMode">{m.contestCreate_scoreboardMode()}</label>
      <select class={inputClassName} id="scoreboardMode" name="scoreboardMode" bind:value={$form.scoreboardMode}>
        <option value="live">{m.contestDetail_live()}</option>
        <option value="frozen">{m.contestDetail_frozen()}</option>
        <option value="hidden">Hidden</option>
      </select>
    </div>

    <div>
      <label class="text-sm font-medium" for="frozenAt">{m.contestCreate_freezeAt()}</label>
      <input
        class={inputClassName}
        id="frozenAt"
        name="frozenAt"
        type="datetime-local"
        bind:value={$form.frozenAt}
      />
    </div>

    <div>
      <label class="text-sm font-medium" for="maxAttempts">{m.contestCreate_maxAttempts()}</label>
      <input
        class={inputClassName}
        id="maxAttempts"
        name="maxAttempts"
        type="number"
        min="1"
        max="999"
        placeholder={m.contestCreate_maxAttemptsPlaceholder()}
        bind:value={$form.maxAttempts}
      />
      {#if $errors.maxAttempts}<p class="mt-1 text-xs text-red-600">{$errors.maxAttempts}</p>{/if}
    </div>

    <!-- Security -->
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <ShieldIcon class="h-4 w-4" />
      <span>Security</span>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="pageLockEnabled" bind:checked={$form.pageLockEnabled} />
        {m.contestCreate_pageLock()}
      </label>
      <label class="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="ipLockEnabled" bind:checked={$form.ipLockEnabled} />
        {m.contestCreate_ipLock()}
      </label>
    </div>

    <div>
      <label class="text-sm font-medium" for="inviteCode">{m.contestCreate_inviteCode()}</label>
      <input
        class={inputClassName}
        id="inviteCode"
        name="inviteCode"
        type="text"
        placeholder={m.contestCreate_inviteCodePlaceholder()}
        bind:value={$form.inviteCode}
      />
      {#if $errors.inviteCode}<p class="mt-1 text-xs text-red-600">{$errors.inviteCode}</p>{/if}
      <p class="mt-1 text-xs text-muted-foreground">
        {m.contestCreate_inviteCodeHint()}
      </p>
    </div>

    <!-- Languages -->
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <CodeIcon class="h-4 w-4" />
      <span>{m.contestCreate_allowedLanguages()}</span>
    </div>
    <div>
      <p class="text-xs text-muted-foreground">{m.contestCreate_allowedLanguagesHint()}</p>
      <div class="mt-2 flex flex-wrap gap-3">
        {#each supportedLanguages as lang (lang)}
          <label class="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={($form.allowedLanguages ?? []).includes(lang)}
              onchange={() => toggleLanguage(lang)}
            />
            {lang}
          </label>
        {/each}
      </div>
      {#if $errors.allowedLanguages}<p class="mt-1 text-xs text-red-600">{$errors.allowedLanguages}</p>{/if}
    </div>

    <!-- Bind to course -->
    {#if data.canBindCourse}
      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <LinkIcon class="h-4 w-4" />
        <span>{m.contestCreate_bindCourse()}</span>
      </div>
      <div>
        <input
          class={inputClassName}
          id="courseSlug"
          name="courseSlug"
          type="text"
          placeholder={m.contestCreate_bindCoursePlaceholder()}
          bind:value={$form.courseSlug}
        />
        {#if $errors.courseSlug}<p class="mt-1 text-xs text-red-600">{$errors.courseSlug}</p>{/if}
        <p class="mt-1 text-xs text-muted-foreground">
          {m.contestCreate_bindCourseHint()}
        </p>
      </div>
    {/if}

    <!-- Problems -->
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <ListIcon class="h-4 w-4" />
      <span>{m.contestCreate_problemSlugs()}</span>
    </div>
    <div>
      <input
        class={inputClassName}
        id="problemSlugsText"
        name="problemSlugsText"
        type="text"
        placeholder={m.contestCreate_problemSlugsPlaceholder()}
        bind:value={$form.problemSlugsText}
      />
      {#if $errors.problemSlugsText}<p class="mt-1 text-xs text-red-600">{$errors.problemSlugsText}</p>{/if}
    </div>

    <button
      class="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      type="submit"
    >
      <TrophyIcon class="h-4 w-4" />
      {m.contestCreate_button()}
    </button>
  </form>
</div>
