<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children?: Snippet;
  }

  // The shell itself doesn't render any exam-scoped chrome — the detail
  // page has its own hero + countdown, the problems page has
  // `<ExamTopStrip>`.  This layout exists to host the proctoring gate in
  // its `+layout.server.ts` sibling; child pages read the gate's payload
  // via the `LayoutData` parent chain.
  let { children }: Props = $props();
</script>

{@render children?.()}
