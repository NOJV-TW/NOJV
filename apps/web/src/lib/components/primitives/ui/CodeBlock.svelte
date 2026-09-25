<script lang="ts">
  import CopyButton from "./CopyButton.svelte";
  import MonacoScriptEditor from "./MonacoScriptEditor.svelte";

  interface Props {
    code: string;
    language?: string;
  }

  let { code, language = "" }: Props = $props();
</script>

<div class="overflow-hidden rounded-lg border border-border">
  <div class="flex items-center justify-between bg-muted/60 px-4 py-2">
    {#if language}
      <span class="text-xs font-medium text-muted-foreground">{language}</span>
    {:else}
      <span></span>
    {/if}
    <CopyButton text={code} />
  </div>
  <MonacoScriptEditor value={code} {language} height="50vh" isReadOnly />
</div>
