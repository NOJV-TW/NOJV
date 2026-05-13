<script lang="ts">
  import type { SuperForm } from "sveltekit-superforms";
  import {
    supportedLanguages,
    type ExamSettingsForm,
    type Language
  } from "@nojv/core";
  import type { FormMessage } from "$lib/types/form-message";
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";
  import { toggleArrayItem } from "$lib/utils";

  type Sf = SuperForm<ExamSettingsForm, FormMessage>;

  interface Props {
    form: Sf["form"];
    errors: Sf["errors"];
    /** Scoring shape, languages, cooldown all freeze once anyone can submit. */
    editable: boolean;
  }

  let { form, errors, editable }: Props = $props();

  function toggleLanguage(lang: Language) {
    if (!editable) return;
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }
</script>

<section
  class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <h3 class="mb-4 text-title-sm font-medium">
    {m.examDetail_settingsSectionScoring()}
  </h3>
  <div class="space-y-4">
    <div class="grid gap-4 md:grid-cols-2">
      <div>
        <label class="text-sm font-medium" for="settings-scoringMode">
          {m.examDetail_settingsScoringModeLabel()}
        </label>
        <select
          id="settings-scoringMode"
          class={inputClassName}
          bind:value={$form.scoringMode}
          disabled={!editable}
        >
          <option value="problem_count">{m.examDetail_scoringProblemCount()}</option>
          <option value="point_sum">{m.examDetail_scoringPointSum()}</option>
        </select>
      </div>
      <div>
        <label class="text-sm font-medium" for="settings-scoreboardMode">
          {m.examDetail_settingsScoreboardModeLabel()}
        </label>
        <select
          id="settings-scoreboardMode"
          class={inputClassName}
          bind:value={$form.scoreboardMode}
          disabled={!editable}
        >
          <option value="live">{m.examCreate_scoreboardLive()}</option>
          <option value="frozen">{m.examCreate_scoreboardFrozen()}</option>
          <option value="hidden">{m.examCreate_scoreboardHidden()}</option>
        </select>
      </div>
    </div>

    <div>
      <div class="text-sm font-medium">
        {m.examDetail_settingsLanguagesLabel()}
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
            disabled={!editable}
          >
            {lang}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <label class="text-sm font-medium" for="settings-cooldown">
        {m.examDetail_settingsCooldownLabel()}
      </label>
      <input
        id="settings-cooldown"
        class={inputClassName}
        type="number"
        min="0"
        max="600"
        bind:value={$form.submitCooldownSec}
        disabled={!editable}
      />
      {#if $errors.submitCooldownSec}
        <p class="mt-1 text-xs text-destructive">{$errors.submitCooldownSec}</p>
      {/if}
    </div>
  </div>
</section>
