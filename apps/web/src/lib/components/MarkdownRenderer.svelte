<script lang="ts">
  import { marked } from "marked";

  let { content = "" }: { content: string } = $props();
  let html = $derived(marked.parse(content, { async: false }) as string);
</script>

<div class="markdown-content">
  {@html html}
</div>
