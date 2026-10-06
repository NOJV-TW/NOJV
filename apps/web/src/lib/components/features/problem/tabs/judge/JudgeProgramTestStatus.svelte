<script lang="ts">
  import type { testJudgeDomain } from "@nojv/application";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";
  import { submitFormAction } from "$lib/utils/actions";

  interface Props {
    status: testJudgeDomain.JudgeProgramStatus;
    testJudgeDisabled: boolean;
    checksSamples: boolean;
    hasUnsavedChanges: boolean;
  }

  let { status, testJudgeDisabled, checksSamples, hasUnsavedChanges }: Props = $props();

  let checking = $state(false);
  let results = $state<testJudgeDomain.CheckerSampleResult[] | null>(null);
  let checkError = $state("");
  let anyRejected = $derived(results?.some(({ verdict }) => verdict !== "AC") ?? false);

  function checkErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : "";
    switch (message) {
      case "test_judge_busy":
        return m.editor_testJudgeBusy();
      case "test_judge_unavailable":
        return m.admin_checkSamplesUnavailable();
      case "judge_program_build_failed":
      case "judge_program_unsupported":
        return m.admin_judgeProgramTestFailed();
      default:
        return message || m.error_unexpected();
    }
  }

  async function checkSamples() {
    checking = true;
    checkError = "";
    results = null;
    try {
      const data = await submitFormAction("?/checkSamples");
      results = data.results as testJudgeDomain.CheckerSampleResult[];
    } catch (err) {
      checkError = checkErrorMessage(err);
    } finally {
      checking = false;
    }
    if (status.status !== "ok") await invalidateAll();
  }
</script>

{#if status.status === "not_applicable"}
  {#if testJudgeDisabled}
    <p class="text-caption text-muted-foreground">{m.admin_testJudgeDisabled()}</p>
  {/if}
{:else}
  <div class="space-y-3">
    <div
      class="rounded-lg border px-3 py-2 text-body-sm {status.status === 'ok'
        ? 'border-success/40 bg-success/10 text-success'
        : status.status === 'failed'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-info/40 bg-info/10 text-info'}"
      role="status"
    >
      {status.status === "ok"
        ? m.admin_judgeProgramTestReady()
        : status.status === "failed"
          ? m.admin_judgeProgramTestFailed()
          : m.admin_judgeProgramTestPending()}
    </div>

    {#if status.status === "failed"}
      <details class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2">
        <summary class="cursor-pointer text-caption font-semibold">
          {m.admin_judgeProgramDiagnostics()}
        </summary>
        <pre
          class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[color:var(--color-panel)] p-3 font-mono text-caption">{status.diagnostics}</pre>
      </details>
    {:else if checksSamples}
      <div class="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={checking}
          disabled={checking || hasUnsavedChanges}
          onclick={checkSamples}
        >
          {checking ? m.admin_checkingSamples() : m.admin_checkSamples()}
        </Button>
        {#if hasUnsavedChanges}
          <span class="text-caption text-muted-foreground"
            >{m.admin_checkSamplesSaveFirst()}</span
          >
        {/if}
      </div>

      {#if checkError}
        <p class="text-body-sm text-destructive" role="alert">{checkError}</p>
      {/if}

      {#if results}
        <ul class="space-y-1.5" aria-label={m.admin_checkSamples()}>
          {#each results as result (result.sampleIndex)}
            {@const accepted = result.verdict === "AC"}
            <li class="rounded-md border border-border-subtle px-3 py-2 text-body-sm">
              <div class="flex items-center gap-2">
                <span aria-hidden="true" class={accepted ? "text-success" : "text-destructive"}
                  >{accepted ? "✓" : "✗"}</span
                >
                <span class="font-medium"
                  >{m.admin_sampleNumber({ number: result.sampleIndex + 1 })}</span
                >
                <VerdictBadge verdict={result.verdict} />
              </div>
              {#if !accepted && result.teamMessage}
                <pre
                  class="mt-1.5 whitespace-pre-wrap font-mono text-caption text-muted-foreground">{result.teamMessage}</pre>
              {/if}
            </li>
          {/each}
        </ul>
        {#if anyRejected}
          <p class="text-caption text-foreground/80">{m.admin_checkSamplesRejected()}</p>
        {/if}
      {/if}
    {/if}
  </div>
{/if}
