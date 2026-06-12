<script lang="ts">
  import type { SuperForm } from "sveltekit-superforms";
  import type { ExamSettingsForm } from "@nojv/core";
  import type { FormMessage } from "$lib/types/form-message";
  import IpWhitelistField from "$lib/components/features/course/exam/IpWhitelistField.svelte";
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";

  type Sf = SuperForm<ExamSettingsForm, FormMessage>;

  interface Props {
    form: Sf["form"];
    editable: boolean;
  }

  let { form, editable }: Props = $props();
</script>

<section
  class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <h3 class="mb-4 text-title-sm font-medium">
    {m.examDetail_settingsSectionProctoring()}
  </h3>
  <div class="space-y-4">
    <label class="flex items-center gap-3 text-body-sm {editable ? '' : 'opacity-60'}">
      <input type="checkbox" bind:checked={$form.pageLockEnabled} disabled={!editable} />
      {m.examDetail_settingsPageLockLabel()}
    </label>

    <label class="flex items-center gap-3 text-body-sm {editable ? '' : 'opacity-60'}">
      <input type="checkbox" bind:checked={$form.ipBindingEnabled} disabled={!editable} />
      {m.examDetail_settingsIpBindingLabel()}
    </label>

    <label class="flex items-center gap-3 text-body-sm {editable ? '' : 'opacity-60'}">
      <input type="checkbox" bind:checked={$form.ipWhitelistEnabled} disabled={!editable} />
      {m.examDetail_settingsIpWhitelistEnabledLabel()}
    </label>

    {#if $form.ipWhitelistEnabled}
      <IpWhitelistField
        id="settings-ipWhitelist"
        label={m.examDetail_settingsIpWhitelistLabel()}
        bind:value={$form.ipWhitelistText}
        disabled={!editable}
        placeholder={m.examCreate_ipWhitelistPlaceholder()}
        importLabel={m.examCreate_ipWhitelistImport()}
        fileTooLargeMessage={m.examCreate_ipWhitelistFileTooLarge()}
      />
    {/if}

    <div>
      <label class="text-sm font-medium" for="settings-ipViolationMode">
        {m.examDetail_settingsIpViolationModeLabel()}
      </label>
      <select
        id="settings-ipViolationMode"
        class={inputClassName}
        bind:value={$form.ipViolationMode}
        disabled={!editable}
      >
        <option value="block">{m.examCreate_violationBlock()}</option>
        <option value="notify">{m.examCreate_violationNotify()}</option>
      </select>
    </div>
  </div>
</section>
