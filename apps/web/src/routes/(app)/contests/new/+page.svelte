<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { superForm } from "sveltekit-superforms/client";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { inputClassName } from "$lib/utils/css";
  import { toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import CodeIcon from "@lucide/svelte/icons/code";
  import ListIcon from "@lucide/svelte/icons/list";
  import { Card } from "$lib/components/primitives/ui/card/index.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";

  let { data } = $props();

  const { form, errors, enhance, submitting, message: formMessage } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    {
      resetForm: false,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.contestCreate_success());
          goto("/contests");
        }
      }
    }
  );

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }
</script>

<div class="space-y-6">
  <div class="flex items-center gap-3">
    <TrophyIcon aria-hidden="true" class="h-8 w-8 text-primary" />
    <h1 class="text-title-lg">{m.contestCreate_title()}</h1>
  </div>

  <Card variant="surface" size="hero" class="max-w-2xl">
    <form method="POST" action="?/create" use:enhance class="space-y-5">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />
    <div>
      <label class="text-sm font-medium" for="id">{m.contestCreate_slug()}</label>
      <input
        class={inputClassName}
        id="id"
        name="id"
        type="text"
        placeholder={m.contestCreate_slugPlaceholder()}
        bind:value={$form.id}
        aria-invalid={Boolean($errors.id)}
        aria-describedby={$errors.id ? "id-error" : undefined}
      />
      {#if $errors.id}<p id="id-error" class="mt-1 text-xs text-destructive">{$errors.id}</p>{/if}
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
        aria-invalid={Boolean($errors.title)}
        aria-describedby={$errors.title ? "title-error" : undefined}
      />
      {#if $errors.title}<p id="title-error" class="mt-1 text-xs text-destructive">{$errors.title}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="summary">{m.contestCreate_summary()}</label>
      <textarea
        class="{inputClassName} min-h-24 resize-y"
        id="summary"
        name="summary"
        placeholder={m.contestCreate_summaryPlaceholder()}
        bind:value={$form.summary}
        aria-invalid={Boolean($errors.summary)}
        aria-describedby={$errors.summary ? "summary-error" : undefined}
      ></textarea>
      {#if $errors.summary}<p id="summary-error" class="mt-1 text-xs text-destructive">{$errors.summary}</p>{/if}
    </div>

    
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <ClockIcon aria-hidden="true" class="h-4 w-4" />
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
          aria-invalid={Boolean($errors.startsAt)}
          aria-describedby={$errors.startsAt ? "startsAt-error" : undefined}
        />
        {#if $errors.startsAt}<p id="startsAt-error" class="mt-1 text-xs text-destructive">{$errors.startsAt}</p>{/if}
      </div>
      <div>
        <label class="text-sm font-medium" for="endsAt">{m.contestCreate_endsAt()}</label>
        <input
          class={inputClassName}
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          bind:value={$form.endsAt}
          aria-invalid={Boolean($errors.endsAt)}
          aria-describedby={$errors.endsAt ? "endsAt-error" : undefined}
        />
        {#if $errors.endsAt}<p id="endsAt-error" class="mt-1 text-xs text-destructive">{$errors.endsAt}</p>{/if}
      </div>
    </div>

    
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <SettingsIcon aria-hidden="true" class="h-4 w-4" />
      <span>{m.contestCreate_scoringMode()}</span>
    </div>
    <div>
      <label class="text-sm font-medium" for="scoringMode">{m.contestCreate_scoringMode()}</label>
      <select class={inputClassName} id="scoringMode" name="scoringMode" bind:value={$form.scoringMode}>
        <option value="problem_count">{m.contestCreate_scoringModeProblemCount()}</option>
        <option value="point_sum">{m.contestCreate_scoringModePointSum()}</option>
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
        aria-invalid={Boolean($errors.submitCooldownSec)}
        aria-describedby={$errors.submitCooldownSec ? "submitCooldownSec-error" : undefined}
      />
      {#if $errors.submitCooldownSec}<p id="submitCooldownSec-error" class="mt-1 text-xs text-destructive">{$errors.submitCooldownSec}</p>{/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="scoreboardMode">{m.contestCreate_scoreboardMode()}</label>
      <select class={inputClassName} id="scoreboardMode" name="scoreboardMode" bind:value={$form.scoreboardMode}>
        <option value="live">{m.contestDetail_live()}</option>
        <option value="frozen">{m.contestDetail_frozen()}</option>
        <option value="hidden">{m.contestCreate_scoreboardModeHidden()}</option>
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
      <label class="text-sm font-medium" for="inviteCode">{m.contestCreate_inviteCode()}</label>
      <input
        class={inputClassName}
        id="inviteCode"
        name="inviteCode"
        type="text"
        placeholder={m.contestCreate_inviteCodePlaceholder()}
        bind:value={$form.inviteCode}
        aria-invalid={Boolean($errors.inviteCode)}
        aria-describedby={$errors.inviteCode ? "inviteCode-error" : undefined}
      />
      {#if $errors.inviteCode}<p id="inviteCode-error" class="mt-1 text-xs text-destructive">{$errors.inviteCode}</p>{/if}
      <p class="mt-1 text-xs text-muted-foreground">
        {m.contestCreate_inviteCodeHint()}
      </p>
    </div>

    
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <CodeIcon aria-hidden="true" class="h-4 w-4" />
      <span>{m.contestCreate_allowedLanguages()}</span>
    </div>
    <div>
      <p class="text-xs text-muted-foreground">{m.contestCreate_allowedLanguagesHint()}</p>
      <div
        class="mt-2 flex flex-wrap gap-3"
        role="group"
        aria-label={m.contestCreate_allowedLanguages()}
        aria-describedby={$errors.allowedLanguages ? "allowedLanguages-error" : undefined}
      >
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
      {#if $errors.allowedLanguages}<p id="allowedLanguages-error" class="mt-1 text-xs text-destructive">{$errors.allowedLanguages}</p>{/if}
    </div>

    
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <ListIcon aria-hidden="true" class="h-4 w-4" />
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
        aria-invalid={Boolean($errors.problemIdsText)}
        aria-describedby={$errors.problemIdsText ? "problemIdsText-error" : undefined}
      />
      {#if $errors.problemIdsText}<p id="problemIdsText-error" class="mt-1 text-xs text-destructive">{$errors.problemIdsText}</p>{/if}
    </div>

      <Button type="submit" size="lg" loading={$submitting}>
        <TrophyIcon aria-hidden="true" class="h-4 w-4" />
        {m.contestCreate_button()}
      </Button>
    </form>
  </Card>
</div>
