<script lang="ts">
  import { Monitor, BookOpen, X } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemDetail } from "$lib/types";
  import { Button } from "$lib/components/primitives/ui/button";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";

  interface Props {
    problem: ProblemDetail;
  }

  let { problem }: Props = $props();

  let showStatement = $state(false);

  function openStatement() {
    showStatement = true;
  }

  function closeStatement() {
    showStatement = false;
  }
</script>

<div
  class="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-border bg-[color:var(--color-panel)] px-6 py-12 text-center shadow-rest"
>
  <div
    class="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10"
    aria-hidden="true"
  >
    <Monitor class="h-8 w-8 text-primary" />
  </div>
  <h2 class="mt-5 text-title font-semibold leading-tight">
    {m.mobile_workspaceBlockerTitle()}
  </h2>
  <p class="mt-2 max-w-sm text-body-sm text-muted-foreground [text-wrap:pretty]">
    {m.mobile_workspaceBlockerDescription()}
  </p>
  <div class="mt-6">
    <Button variant="outline" onclick={openStatement} type="button">
      <BookOpen class="size-4" aria-hidden="true" />
      {m.mobile_viewStatementFullscreen()}
    </Button>
  </div>
</div>

{#if showStatement}
  
  <div
    class="fixed inset-0 z-[var(--z-modal,80)] flex flex-col bg-background"
    role="dialog"
    aria-modal="true"
    aria-label={m.mobile_statementDialogLabel()}
  >
    <header
      class="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-[color:var(--color-panel)] px-4"
    >
      <h2 class="truncate text-body-sm font-semibold">{problem.title}</h2>
      <button
        type="button"
        onclick={closeStatement}
        class="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
        aria-label={m.mobile_closeStatement()}
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </header>
    <div class="flex-1 overflow-y-auto px-5 py-5">
      <h1 class="text-title font-semibold leading-snug">{problem.title}</h1>

      <div class="mt-4 text-body-sm leading-7 text-foreground">
        <MarkdownRenderer content={problem.statement} />
      </div>

      {#if problem.inputFormat}
        <div class="mt-5">
          <p class="text-body-sm font-semibold">{m.problemDetail_inputFormat()}:</p>
          <div class="mt-1 text-body-sm leading-7 text-foreground">
            <MarkdownRenderer content={problem.inputFormat} />
          </div>
        </div>
      {/if}

      {#if problem.outputFormat}
        <div class="mt-5">
          <p class="text-body-sm font-semibold">{m.problemDetail_outputFormat()}:</p>
          <div class="mt-1 text-body-sm leading-7 text-foreground">
            <MarkdownRenderer content={problem.outputFormat} />
          </div>
        </div>
      {/if}

      {#each problem.samples as sample, index (`sample-${index}`)}
        <div class="mt-6 {index > 0 ? 'border-t border-border-subtle pt-6' : ''}">
          <p class="text-body font-semibold">
            {m.problemDetail_sample()} {index + 1}
          </p>
          <div class="mt-3 space-y-3 text-body-sm">
            <div>
              <p class="text-caption font-medium text-muted-foreground">
                {m.problemDetail_input()}
              </p>
              <pre
                class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-caption leading-6 text-foreground">{sample.input}</pre>
            </div>
            <div>
              <p class="text-caption font-medium text-muted-foreground">
                {m.problemDetail_output()}
              </p>
              <pre
                class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-caption leading-6 text-foreground">{sample.output}</pre>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}
