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
    editableStart: boolean;
    editableEnd: boolean;
    isRunning: boolean;
  }

  let { form, errors, editableStart, editableEnd, isRunning }: Props = $props();
</script>

<div class="grid gap-4 md:grid-cols-2">
  <div>
    <label class="text-sm font-medium" for="settings-starts">
      {m.examDetail_settingsStartsLabel()}
    </label>
    <input
      id="settings-starts"
      class={inputClassName}
      type="datetime-local"
      bind:value={$form.startsAt}
      disabled={!editableStart}
    />
    {#if $errors.startsAt}
      <p class="mt-1 text-xs text-destructive">{$errors.startsAt}</p>
    {/if}
  </div>
  <div>
    <label class="text-sm font-medium" for="settings-ends">
      {m.examDetail_settingsEndsLabel()}
    </label>
    <input
      id="settings-ends"
      class={inputClassName}
      type="datetime-local"
      bind:value={$form.endsAt}
      disabled={!editableEnd}
    />
    {#if $errors.endsAt}
      <p class="mt-1 text-xs text-destructive">{$errors.endsAt}</p>
    {/if}
    {#if isRunning}
      <p class="mt-1 text-caption text-muted-foreground">
        {m.examDetail_settingsEndsRunningHint()}
      </p>
    {/if}
  </div>
</div>
