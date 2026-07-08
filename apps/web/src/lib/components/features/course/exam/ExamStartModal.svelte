<script lang="ts">
  import { enhance } from "$app/forms";
  import { AlertTriangle } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import * as Dialog from "$lib/components/primitives/ui/dialog";

  interface Props {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    examTitle: string;
    problemCount: number;
    durationMinutes: number;
    action?: string;
  }

  let {
    open,
    onOpenChange,
    examTitle,
    problemCount,
    durationMinutes,
    action = "?/startExam",
  }: Props = $props();

  let hasAgreed = $state(false);
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    if (!open) {
      hasAgreed = false;
      submitting = false;
      errorMessage = null;
    }
  });
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content
    class="max-w-lg border-[color:color-mix(in_oklab,var(--destructive)_30%,var(--border))]"
  >
    <Dialog.Header>
      <div class="flex items-start gap-4">
        <div
          class="rounded-lg p-2.5"
          style="background: color-mix(in oklab, var(--destructive) 14%, transparent);"
        >
          <AlertTriangle
            aria-hidden="true"
            class="size-5"
            style="color: var(--destructive);"
            strokeWidth={2}
          />
        </div>
        <div class="flex-1">
          <Dialog.Title class="text-title font-semibold"
            >{m.examStartModal_title()}</Dialog.Title
          >
          <Dialog.Description class="mt-1 text-body-sm text-muted-foreground">
            {m.examStartModal_summary({
              title: examTitle,
              count: problemCount,
              minutes: durationMinutes,
            })}
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    <div class="mt-2 rounded-lg bg-muted p-2">
      <div class="mb-2 font-mono text-micro uppercase tracking-wider text-muted-foreground">
        {m.examStartModal_checklistHeading()}
      </div>
      <ul class="space-y-1.5 text-body-sm">
        <li class="flex gap-2">
          <span class="text-muted-foreground">·</span>{m.examStartModal_rule1()}
        </li>
        <li class="flex gap-2">
          <span class="text-muted-foreground">·</span>{m.examStartModal_rule2()}
        </li>
        <li class="flex gap-2">
          <span class="text-muted-foreground">·</span>{m.examStartModal_rule3()}
        </li>
        <li class="flex gap-2">
          <span class="text-muted-foreground">·</span>{m.examStartModal_rule4()}
        </li>
      </ul>
    </div>

    <label class="mt-4 flex cursor-pointer select-none items-center gap-2.5 text-body-sm">
      <input
        type="checkbox"
        bind:checked={hasAgreed}
        class="size-4 rounded"
        style="accent-color: var(--primary);"
      />
      <span>{m.examStartModal_agree()}</span>
    </label>

    {#if errorMessage}
      <p
        class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body-sm text-destructive"
        role="alert"
      >
        {errorMessage}
      </p>
    {/if}

    <Dialog.Footer class="mt-4 flex justify-end gap-3">
      <button
        type="button"
        onclick={() => onOpenChange(false)}
        class="rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors hover:bg-muted"
      >
        {m.examStartModal_cancel()}
      </button>
      <form
        method="POST"
        {action}
        use:enhance={() => {
          errorMessage = null;
          submitting = true;
          return async ({ result, update }) => {
            await update();
            if (result.type === "success") {
              onOpenChange(false);
            } else if (result.type === "failure") {
              errorMessage =
                typeof result.data?.error === "string"
                  ? result.data.error
                  : m.error_unexpected();
            } else {
              errorMessage = m.error_unexpected();
            }
            submitting = false;
          };
        }}
      >
        <Button type="submit" variant="default" disabled={!hasAgreed} loading={submitting}>
          {m.examStartModal_start()}
        </Button>
      </form>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
