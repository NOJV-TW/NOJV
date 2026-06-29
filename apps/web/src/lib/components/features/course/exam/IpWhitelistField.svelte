<script lang="ts">
  import Upload from "@lucide/svelte/icons/upload";
  import { IP_WHITELIST_MAX_TEXT_LENGTH } from "@nojv/core";

  import { Button } from "$lib/components/primitives/ui/button";
  import { cn, inputClassName } from "$lib/utils/css";

  interface Props {
    id: string;
    value: string;
    label: string;
    placeholder: string;
    importLabel: string;
    fileTooLargeMessage: string;
    disabled?: boolean;
    class?: string;
    ariaInvalid?: "true" | undefined;
  }

  let {
    id,
    value = $bindable(""),
    label,
    placeholder,
    importLabel,
    fileTooLargeMessage,
    disabled = false,
    class: className,
    ariaInvalid,
  }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let importError = $state<string | null>(null);

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    importing = true;
    importError = null;
    try {
      const text = await file.text();
      if (text.length > IP_WHITELIST_MAX_TEXT_LENGTH) {
        importError = fileTooLargeMessage;
        return;
      }
      value = text;
    } finally {
      importing = false;
      input.value = "";
    }
  }
</script>

<div>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <label class="text-sm font-medium" for={id}>
      {label}
    </label>
    <input
      bind:this={fileInput}
      type="file"
      accept=".csv,.txt,text/csv,text/plain"
      class="sr-only"
      disabled={disabled || importing}
      onchange={importFile}
    />
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || importing}
      onclick={() => fileInput?.click()}
    >
      <Upload class="h-4 w-4" aria-hidden="true" />
      {importLabel}
    </Button>
  </div>
  <textarea
    {id}
    class={cn(inputClassName, "mt-2 min-h-24 resize-y font-mono", className)}
    {placeholder}
    bind:value
    {disabled}
    aria-invalid={ariaInvalid}></textarea>
  {#if importError}
    <p class="mt-1 text-xs text-destructive">{importError}</p>
  {/if}
</div>
