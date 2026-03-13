<script lang="ts">
  import DOMPurify from "isomorphic-dompurify";
  import { marked, PURIFY_CONFIG } from "$lib/markdown";
  import "katex/dist/katex.min.css";

  let { content = "" }: { content: string } = $props();
  let html = $derived(
    DOMPurify.sanitize(marked.parse(content, { async: false }) as string, PURIFY_CONFIG),
  );
</script>

<div class="markdown-content">
  {@html html}
</div>
