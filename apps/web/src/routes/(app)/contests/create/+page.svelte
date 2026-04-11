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
  import { Card } from "$lib/components/ui/card/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import FormError from "$lib/components/ui/FormError.svelte";
  import type { FormMessage } from "$lib/types/form-message";

  let { data } = $props();

  const { form, errors, enhance, message: formMessage } = superForm<typeof data.form.data, FormMessage>(untrack(() => data.form), {
    resetForm: false
  });

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }
</script>

<div class="space-y-6">
  <div class="flex items-center gap-3">
    <TrophyIcon class="h-8 w-8 text-primary" />
    <h1 class="font-display text-title-lg">{m.contestCreate_title()}</h1>
  </div>

  {#if $formMessage?.kind === "success"}
    <p class="mt-4 text-body-sm text-success">{$formMessage.text}</p>
  {/if}

  <Card variant="surface" size="hero" class="max-w-2xl">
    <form method="POST" action="?/create" use:enhance class="space-y-5">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />
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
        <option value="problem_count">Problem count (ICPC-style, penalty tiebreaker)</option>
        <option value="point_sum">Point sum (IOI-style, partial credit)</option>
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
        <input type="checkbox" name="ipWhitelistEnabled" bind:checked={$form.ipWhitelistEnabled} />
        IP Whitelist
      </label>
      <label class="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="ipBindingEnabled" bind:checked={$form.ipBindingEnabled} />
        IP Binding
      </label>
    </div>
    {#if $form.ipWhitelistEnabled}
      <div>
        <textarea
          class="{inputClassName} min-h-24 resize-y"
          name="ipWhitelistText"
          bind:value={$form.ipWhitelistText}
          placeholder="CIDR ranges, one per line&#10;e.g. 140.112.0.0/16&#10;     192.168.1.0/24"
          rows="3"
        ></textarea>
      </div>
    {/if}
    {#if $form.ipWhitelistEnabled || $form.ipBindingEnabled}
      <div class="flex items-center gap-4 text-sm">
        <span class="text-muted-foreground">When IP violation occurs:</span>
        <label class="flex items-center gap-1.5">
          <input type="radio" name="ipViolationMode" value="block" bind:group={$form.ipViolationMode} />
          Block
        </label>
        <label class="flex items-center gap-1.5">
          <input type="radio" name="ipViolationMode" value="notify" bind:group={$form.ipViolationMode} />
          Notify only
        </label>
      </div>
    {/if}

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
      <span>{m.contestCreate_problemIds()}</span>
    </div>
    <div>
      <input
        class={inputClassName}
        id="problemIdsText"
        name="problemIdsText"
        type="text"
        placeholder={m.contestCreate_problemIdsPlaceholder()}
        bind:value={$form.problemIdsText}
      />
      {#if $errors.problemIdsText}<p class="mt-1 text-xs text-red-600">{$errors.problemIdsText}</p>{/if}
    </div>

      <Button type="submit" size="lg">
        <TrophyIcon class="h-4 w-4" />
        {m.contestCreate_button()}
      </Button>
    </form>
  </Card>
</div>
