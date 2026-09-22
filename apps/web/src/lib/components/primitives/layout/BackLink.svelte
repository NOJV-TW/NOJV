<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";
  import { afterNavigate } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css";

  interface Props {
    href: string;
    label: string;
    class?: string | undefined;
  }

  let { href, label, class: className }: Props = $props();
  let inAppHistory = $state(false);

  afterNavigate(({ from }) => {
    inAppHistory = from !== null;
  });

  function handleClick(event: MouseEvent) {
    if (
      !inAppHistory ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    window.history.back();
  }
</script>

<a
  {href}
  class={cn(
    "inline-flex items-center gap-1.5 text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground",
    className,
  )}
  onclick={handleClick}
>
  <ArrowLeft aria-hidden="true" class="size-4" />
  {inAppHistory ? m.common_back() : label}
</a>
