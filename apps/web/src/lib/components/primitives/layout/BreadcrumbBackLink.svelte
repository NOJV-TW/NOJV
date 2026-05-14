<script lang="ts">
  import { ChevronLeft } from "@lucide/svelte";

  interface Props {
    href: string;
    label: string;
  }

  let { href, label }: Props = $props();
</script>

<a
  {href}
  class="inline-flex items-center gap-1 text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
>
  <ChevronLeft class="size-4" aria-hidden="true" />
  <span>{label}</span>
</a>
