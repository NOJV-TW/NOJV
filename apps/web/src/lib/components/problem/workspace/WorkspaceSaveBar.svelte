<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    saving: boolean;
    /** "" = idle, "saved" = success, "error" = failure, otherwise validation message. */
    saveMessage: string;
    onSave: () => void;
  }

  let { saving, saveMessage, onSave }: Props = $props();
</script>

<div class="flex items-center justify-end gap-3">
  <button
    type="button"
    class="inline-flex rounded-full bg-primary px-5 py-3 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
    disabled={saving}
    onclick={onSave}
  >
    {saving ? m.common_saving() : m.common_saveDraft()}
  </button>
  {#if saveMessage === "saved"}
    <span class="text-body-sm text-success">{m.admin_saved()}</span>
  {:else if saveMessage === "error"}
    <span class="text-body-sm text-destructive">{m.admin_saveFailed()}</span>
  {:else if saveMessage !== ""}
    <span class="text-body-sm text-destructive">{saveMessage}</span>
  {/if}
</div>
