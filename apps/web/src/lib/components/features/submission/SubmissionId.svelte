<script lang="ts">
  import CopyButton from "$lib/components/primitives/ui/CopyButton.svelte";
  import { m } from "$lib/paraglide/messages.js";

  let { id }: { id: string } = $props();
</script>

<span
  class="inline-flex w-full max-w-full items-center justify-between gap-2 text-caption text-muted-foreground"
  data-submission-id={id}
>
  <span class="sr-only">{m.submission_id()}</span>
  <span class="min-w-0 break-all font-mono" title={id}>{id}</span>
  <CopyButton text={id} label={m.submission_copyId()} class="shrink-0" />
</span>
