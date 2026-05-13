<script lang="ts">
  import DOMPurify from "isomorphic-dompurify";
  import { marked, PURIFY_CONFIG } from "$lib/utils/markdown";
  import "katex/dist/katex.min.css";

  let { content = "" }: { content: string } = $props();
  let html = $derived(
    DOMPurify.sanitize(marked.parse(content, { async: false }) as string, PURIFY_CONFIG),
  );
</script>

<div class="markdown-content">
  {@html html}
</div>

<style>
  .markdown-content :global(p) {
    margin: 0 0 1rem 0;
  }
  .markdown-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-content :global(h1),
  .markdown-content :global(h2),
  .markdown-content :global(h3),
  .markdown-content :global(h4) {
    color: var(--color-foreground);
    font-weight: 600;
    line-height: 1.35;
  }
  .markdown-content :global(h2) {
    font-size: var(--text-title-sm);
    margin-top: 2rem;
    margin-bottom: 0.75rem;
  }
  .markdown-content :global(h3) {
    font-size: 1.0625rem;
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
  }
  .markdown-content :global(h2:first-child),
  .markdown-content :global(h3:first-child) {
    margin-top: 0;
  }

  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    margin: 0 0 1rem 0;
    padding-left: 1.5rem;
  }
  .markdown-content :global(ul) {
    list-style-type: disc;
  }
  .markdown-content :global(ol) {
    list-style-type: decimal;
  }
  .markdown-content :global(li) {
    margin: 0.25rem 0;
  }
  .markdown-content :global(li > p) {
    margin: 0;
  }

  .markdown-content :global(strong) {
    color: var(--color-foreground);
    font-weight: 600;
  }
  .markdown-content :global(em) {
    font-style: italic;
  }

  .markdown-content :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: opacity 120ms ease;
  }
  .markdown-content :global(a:hover) {
    opacity: 0.8;
  }

  .markdown-content :global(code) {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--color-panel-strong);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 0.875em;
  }
  .markdown-content :global(pre) {
    margin: 0 0 1rem 0;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--color-panel-strong);
    overflow-x: auto;
  }
  .markdown-content :global(pre code) {
    padding: 0;
    background: transparent;
    font-size: 0.875em;
  }

  .markdown-content :global(blockquote) {
    margin: 0 0 1rem 0;
    padding-left: 1rem;
    border-left: 3px solid var(--color-border);
  }

  .markdown-content :global(hr) {
    margin: 1.5rem 0;
    border: 0;
    border-top: 1px solid var(--color-border);
  }

  .markdown-content :global(table) {
    margin: 0 0 1rem 0;
    border-collapse: collapse;
    width: 100%;
  }
  .markdown-content :global(th),
  .markdown-content :global(td) {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--color-border);
    text-align: left;
  }
  .markdown-content :global(th) {
    background: var(--color-panel-strong);
    font-weight: 600;
    color: var(--color-foreground);
  }
</style>
