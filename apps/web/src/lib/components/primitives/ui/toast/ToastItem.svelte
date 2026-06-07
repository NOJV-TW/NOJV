<script lang="ts">
  import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { cn } from "$lib/utils/css.js";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts, type Toast, type ToastType } from "$lib/stores/toast";
  import { Button } from "$lib/components/primitives/ui/button";

  interface Props {
    toast: Toast;
  }
  let { toast }: Props = $props();

  const icons = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  } as const;

  const iconTint: Record<ToastType, string> = {
    success: "bg-success/15 text-success",
    error: "bg-destructive/15 text-destructive",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
  };

  const Icon = $derived(icons[toast.type]);
  const isError = $derived(toast.type === "error");

  let prefersReducedMotion = $state(false);
  $effect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  async function handleUndo() {
    if (!toast.undo) return;
    try {
      await toast.undo.onUndo();
    } finally {
      toasts.remove(toast.id);
    }
  }
</script>

{#if prefersReducedMotion}
  <div
    class={cn(
      "pointer-events-auto flex min-w-[280px] max-w-[420px] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-hover backdrop-blur-sm",
    )}
    role={isError ? "alert" : "status"}
    aria-live={isError ? "assertive" : "polite"}
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 100 }}
  >
    {@render body()}
  </div>
{:else}
  <div
    class={cn(
      "pointer-events-auto flex min-w-[280px] max-w-[420px] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-hover backdrop-blur-sm",
    )}
    role={isError ? "alert" : "status"}
    aria-live={isError ? "assertive" : "polite"}
    in:fly={{ y: 16, duration: 240, easing: cubicOut }}
    out:fly={{ y: 8, duration: 140, easing: cubicOut }}
  >
    {@render body()}
  </div>
{/if}

{#snippet body()}
  <span
    class={cn(
      "flex size-8 shrink-0 items-center justify-center rounded-sm",
      iconTint[toast.type],
    )}
    aria-hidden="true"
  >
    <Icon class="size-4" />
  </span>

  <span class="flex-1 text-body-sm tabular-nums">{toast.message}</span>

  {#if toast.undo}
    <Button
      variant="ghost"
      size="sm"
      class="rounded-full px-3 text-body-sm font-medium"
      onclick={handleUndo}
    >
      {toast.undo.label}
    </Button>
  {/if}

  {#if toast.dismissible}
    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      onclick={() => toasts.remove(toast.id)}
      aria-label={m.common_dismissNotification()}
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  {/if}
{/snippet}
