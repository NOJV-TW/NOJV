<script lang="ts">
  import type { SuperForm } from "sveltekit-superforms";
  import type { ExamSettingsForm } from "@nojv/core";
  import type { FormMessage } from "$lib/types/form-message";
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";

  type Sf = SuperForm<ExamSettingsForm, FormMessage>;

  interface Props {
    form: Sf["form"];
    errors: Sf["errors"];
    editable: boolean;
  }

  let { form, errors, editable }: Props = $props();
</script>

<section
  class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <h3 class="mb-4 text-title-sm font-medium">
    {m.examDetail_settingsSectionBasic()}
  </h3>
  <div class="space-y-4">
    <div>
      <label class="text-sm font-medium" for="settings-title">
        {m.examDetail_settingsTitleLabel()}
      </label>
      <input
        id="settings-title"
        class={inputClassName}
        type="text"
        bind:value={$form.title}
        disabled={!editable}
        aria-invalid={$errors.title ? "true" : undefined}
      />
      {#if $errors.title}
        <p class="mt-1 text-xs text-destructive">{$errors.title}</p>
      {/if}
    </div>

    <div>
      <label class="text-sm font-medium" for="settings-summary">
        {m.examDetail_settingsSummaryLabel()}
      </label>
      <textarea
        id="settings-summary"
        class="{inputClassName} min-h-24 resize-y"
        bind:value={$form.summary}
        disabled={!editable}
      ></textarea>
    </div>
  </div>
</section>
