<script lang="ts">
  import DOMPurify from "isomorphic-dompurify";
  import { marked } from "marked";

  let { content = "" }: { content: string } = $props();
  let html = $derived(DOMPurify.sanitize(marked.parse(content, { async: false }) as string));
</script>

<div class="markdown-content">
  {@html html}
</div>
