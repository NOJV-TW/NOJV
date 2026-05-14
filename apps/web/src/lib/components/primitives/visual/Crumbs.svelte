<script lang="ts" module>
  export interface CrumbItem {
    label: string;
    href?: string;
  }
</script>

<script lang="ts">
  import { goto } from "$app/navigation";

  interface Props {
    items: CrumbItem[];
  }

  let { items }: Props = $props();

  function handleClick(event: MouseEvent, href: string) {
    event.preventDefault();
    void goto(href);
  }
</script>

<nav class="flex items-center gap-1.5 text-caption text-muted-foreground font-mono">
  {#each items as it, i (i)}
    {#if i > 0}
      <span class="opacity-60">/</span>
    {/if}
    {#if it.href}
      <a
        href={it.href}
        onclick={(e) => handleClick(e, it.href as string)}
        class="hover:text-foreground transition-colors"
      >
        {it.label}
      </a>
    {:else}
      <span class="text-foreground">{it.label}</span>
    {/if}
  {/each}
</nav>
