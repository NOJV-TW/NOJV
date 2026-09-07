<script lang="ts">
  import MonacoScriptEditor from "./MonacoScriptEditor.svelte";

  interface Props {
    code: string;
    language?: string;
    maxHeight?: string;
  }

  let { code, language = "", maxHeight }: Props = $props();
</script>

<MonacoScriptEditor value={code} {language} height={maxHeight ?? "100%"} isReadOnly />
