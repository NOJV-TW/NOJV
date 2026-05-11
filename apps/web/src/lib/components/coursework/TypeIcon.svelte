<script lang="ts">
  import type { CourseworkKind } from "./StatusPill.svelte";

  interface Props {
    kind: CourseworkKind;
    size?: number;
    strokeWidth?: number;
    class?: string;
  }

  let { kind, size = 18, strokeWidth = 1.6, class: className }: Props = $props();
</script>

{#if kind === "assignment"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
  >
    <path d="M7 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M15 4v4h4" />
    <path d="M9 13l2 2 4-4" />
  </svg>
{:else if kind === "exam"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
  >
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 8h2M18 8h2M4 16h2M18 16h2" />
    <path d="M8 12h8" />
    <path d="M12 9v6" />
  </svg>
{:else if kind === "contest"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class={className}
  >
    <path d="M8 4h8v3a4 4 0 0 1-8 0V4z" />
    <path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3" />
    <path d="M10 11v4M14 11v4" />
    <path d="M8 20h8M9 20l1-3h4l1 3" />
  </svg>
{/if}
