<script lang="ts">
  import type { Writable } from "svelte/store";
  import type { ValidationErrors } from "sveltekit-superforms";
  import type { AssessmentSettingsFormData } from "@nojv/core";
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    form: Writable<AssessmentSettingsFormData>;
    errors: Writable<ValidationErrors<AssessmentSettingsFormData>>;
    editableBasics: boolean;
    editableOpensAt: boolean;
    editableDeadlines: boolean;
  }

  let { form, errors, editableBasics, editableOpensAt, editableDeadlines }: Props = $props();
</script>

<section
  class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <h3 class="mb-4 text-title-sm font-medium">
    {m.assignmentDetail_settingsSectionBasic()}
  </h3>
  <div class="space-y-4">
    <div>
      <label class="text-sm font-medium" for="settings-title">
        {m.assignmentDetail_settingsTitleLabel()}
      </label>
      <input
        id="settings-title"
        class={inputClassName}
        type="text"
        bind:value={$form.title}
        disabled={!editableBasics}
        aria-invalid={$errors.title ? "true" : undefined}
      />
      {#if $errors.title}
        <p class="mt-1 text-xs text-destructive">{$errors.title}</p>
      {/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="settings-summary">
        {m.assignmentDetail_settingsSummaryLabel()}
      </label>
      <textarea
        id="settings-summary"
        class="{inputClassName} min-h-24 resize-y"
        bind:value={$form.summary}
        disabled={!editableBasics}
      ></textarea>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <div>
        <label class="text-sm font-medium" for="settings-opens">
          {m.assignmentDetail_settingsOpensLabel()}
        </label>
        <input
          id="settings-opens"
          class={inputClassName}
          type="datetime-local"
          bind:value={$form.opensAt}
          disabled={!editableOpensAt}
        />
        {#if $errors.opensAt}
          <p class="mt-1 text-xs text-destructive">{$errors.opensAt}</p>
        {/if}
      </div>
      <div>
        <label class="text-sm font-medium" for="settings-due">
          {m.assignmentDetail_settingsDueLabel()}
        </label>
        <input
          id="settings-due"
          class={inputClassName}
          type="datetime-local"
          bind:value={$form.dueAt}
          disabled={!editableDeadlines}
        />
        {#if $errors.dueAt}
          <p class="mt-1 text-xs text-destructive">{$errors.dueAt}</p>
        {/if}
      </div>
      <div>
        <label class="text-sm font-medium" for="settings-closes">
          {m.assignmentDetail_settingsClosesLabel()}
        </label>
        <input
          id="settings-closes"
          class={inputClassName}
          type="datetime-local"
          bind:value={$form.closesAt}
          disabled={!editableDeadlines}
        />
        {#if $errors.closesAt}
          <p class="mt-1 text-xs text-destructive">{$errors.closesAt}</p>
        {/if}
      </div>
    </div>
  </div>
</section>
