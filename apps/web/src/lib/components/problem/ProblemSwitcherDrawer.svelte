<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemSolveSibling } from "./ProblemSolveView.svelte";

  interface Props {
    siblings: ProblemSolveSibling[];
    /** Pre-computed count of fully-AC'd siblings. Header shows `solved/total`. */
    solvedCount: number;
  }

  let { siblings, solvedCount }: Props = $props();

  let open = $state(false);

  function close() {
    open = false;
  }

  function toggle() {
    open = !open;
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  function rowClass(s: ProblemSolveSibling): string {
    if (s.isActive) return "border-primary bg-card shadow-rest";
    if (s.bestScore !== undefined && s.bestScore >= s.maxScore) {
      return "border-transparent hover:border-success/30 hover:bg-success/5";
    }
    if (s.bestScore !== undefined && s.bestScore > 0) {
      return "border-transparent hover:border-destructive/30 hover:bg-destructive/5";
    }
    return "border-transparent hover:bg-muted";
  }

  function chipClass(s: ProblemSolveSibling): string {
    if (s.isActive) return "bg-primary text-primary-foreground";
    if (s.bestScore !== undefined && s.bestScore >= s.maxScore) {
      return "bg-success/15 text-success";
    }
    if (s.bestScore !== undefined && s.bestScore > 0) {
      return "bg-destructive/15 text-destructive";
    }
    return "bg-muted text-muted-foreground";
  }

  function scoreClass(s: ProblemSolveSibling): string {
    if (s.bestScore === undefined) return "text-muted-foreground";
    if (s.bestScore >= s.maxScore) return "text-success";
    if (s.bestScore > 0) return "text-destructive";
    return "text-muted-foreground";
  }

  function formatScore(s: ProblemSolveSibling): string {
    if (s.bestScore === undefined) return "—";
    if (s.bestScore >= s.maxScore) return String(s.maxScore);
    return `${String(s.bestScore)}/${String(s.maxScore)}`;
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- Trigger bar: always-visible 24px sliver on the left edge of the workspace. -->
<button
  type="button"
  class="group absolute inset-y-0 left-0 z-20 flex w-6 shrink-0 flex-col items-center justify-center gap-2 border-r border-border-subtle bg-[color:var(--color-panel)] text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-muted hover:text-foreground"
  aria-label={m.problemSwitcher_triggerLabel()}
  aria-expanded={open}
  onclick={toggle}
>
  <span
    aria-hidden="true"
    class="text-caption transition-transform duration-fast ease-out-soft {open ? 'rotate-180' : ''}"
  >
    ▶
  </span>
  <span
    class="font-medium uppercase tracking-[0.18em] text-caption [writing-mode:vertical-rl]"
  >
    {m.problemSwitcher_triggerLabel()}
  </span>
</button>

{#if open}
  <!-- Backdrop: dims only the workspace area, not the entire viewport. -->
  <button
    type="button"
    class="absolute inset-0 z-20 cursor-default bg-background/40 backdrop-blur-[1px]"
    aria-label={m.problemSwitcher_closeLabel()}
    onclick={close}
    transition:fade={{ duration: 120 }}
  ></button>

  <!-- Drawer panel: slides in from the left, leaves the 24px trigger visible. -->
  <aside
    class="absolute inset-y-0 left-6 z-30 flex w-60 flex-col overflow-hidden border-r border-border bg-card shadow-rest"
    transition:fly={{ x: -240, duration: 200, easing: cubicOut }}
  >
    <header
      class="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3"
    >
      <span
        class="text-caption font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {m.problemSwitcher_drawerHeading()}
      </span>
      <span class="font-mono text-caption tabular-nums text-muted-foreground">
        {m.problemSwitcher_progress({ solved: solvedCount, total: siblings.length })}
      </span>
    </header>

    <nav class="flex-1 overflow-y-auto px-2 py-2">
      {#each siblings as sibling (sibling.id)}
        <a
          class="mb-1 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md border px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-fast ease-out-soft {rowClass(
            sibling,
          )}"
          href={sibling.href}
          aria-current={sibling.isActive ? "page" : undefined}
          onclick={close}
        >
          <span
            class="flex size-6 items-center justify-center rounded-sm text-caption font-medium {chipClass(
              sibling,
            )}"
          >
            {sibling.letter}
          </span>
          <span class="truncate text-body-sm font-medium leading-tight text-foreground">
            {sibling.title}
          </span>
          <span class="font-mono text-caption tabular-nums {scoreClass(sibling)}">
            {formatScore(sibling)}
          </span>
        </a>
      {/each}
    </nav>
  </aside>
{/if}
