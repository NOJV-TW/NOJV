<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import type { JudgeType } from "@nojv/core";
  import { inputClassName, monoTextareaClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";

  interface Sample {
    input: string;
    output: string;
    explanation?: string | undefined;
    interactorInput?: string | undefined;
  }

  interface Props {
    samples: Sample[];
    judgeType?: JudgeType | undefined;
  }

  let { samples = $bindable([]), judgeType }: Props = $props();

  const uid = $props.id();
  let interactive = $derived(judgeType === "interactive");

  const MAX_SAMPLES = 5;

  function addSample() {
    if (samples.length >= MAX_SAMPLES) return;
    samples = [...samples, { input: "", output: "" }];
  }

  function removeSample(index: number) {
    samples = samples.filter((_, i) => i !== index);
  }

  function updateInput(index: number, value: string) {
    samples = samples.map((s, i) => (i === index ? { ...s, input: value } : s));
  }

  function updateOutput(index: number, value: string) {
    samples = samples.map((s, i) => (i === index ? { ...s, output: value } : s));
  }

  function updateExplanation(index: number, value: string) {
    samples = samples.map((s, i) => (i === index ? { ...s, explanation: value } : s));
  }

  function updateInteractorInput(index: number, value: string) {
    samples = samples.map((s, i) => (i === index ? { ...s, interactorInput: value } : s));
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-body-sm font-semibold">{m.admin_sampleIO()}</h3>
      <p class="mt-0.5 text-caption text-muted-foreground">
        {m.admin_sampleIOHint()}
      </p>
    </div>
    <span class="text-caption text-muted-foreground tabular-nums"
      >{samples.length} / {MAX_SAMPLES}</span
    >
  </div>

  {#if samples.length === 0}
    <div
      class="rounded-xl border border-dashed border-border-subtle p-4 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_noSamplesYet()}
    </div>
  {:else}
    <div class="space-y-3">
      {#each samples as sample, index (`sample-${index}`)}
        <div class="rounded-xl border border-border-subtle p-3">
          <div class="flex items-center justify-between">
            <span class="text-caption font-semibold text-muted-foreground">
              {m.admin_sampleNumber({ number: index + 1 })}
            </span>
            <button
              type="button"
              class="rounded p-1 text-muted-foreground transition-[color] duration-fast ease-out-soft hover:bg-transparent hover:text-destructive"
              onclick={() => removeSample(index)}
              aria-label={m.admin_removeSample()}
              title={m.admin_removeSample()}
            >
              <X aria-hidden="true" class="size-4" />
            </button>
          </div>
          {#if interactive}
            <label class="mt-2 block text-caption text-muted-foreground">
              <span
                >{m.problemEditor_sampleInteractorInput()}
                <span class="text-destructive">*</span></span
              >
              <textarea
                class={monoTextareaClassName}
                required
                aria-describedby="{uid}-interactor-help-{index}"
                value={sample.interactorInput ?? ""}
                oninput={(e) =>
                  updateInteractorInput(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
            <p
              id="{uid}-interactor-help-{index}"
              class="mt-1 text-caption text-muted-foreground"
            >
              {m.problemEditor_sampleInteractorInputHelp()}
            </p>
          {/if}
          <div class="mt-2 grid gap-3 md:grid-cols-2">
            <label class="text-caption text-muted-foreground">
              <span
                >{interactive
                  ? m.problemEditor_sampleTranscriptInteractor()
                  : m.admin_sampleInput()}</span
              >
              <textarea
                class="{monoTextareaClassName} min-h-24"
                value={sample.input}
                oninput={(e) => updateInput(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
            <label class="text-caption text-muted-foreground">
              <span
                >{interactive
                  ? m.problemEditor_sampleTranscriptProgram()
                  : m.admin_sampleOutput()}</span
              >
              <textarea
                class="{monoTextareaClassName} min-h-24"
                value={sample.output}
                oninput={(e) => updateOutput(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          </div>
          <label class="mt-3 block text-caption text-muted-foreground">
            <span>{m.admin_sampleExplanation()}</span>
            <textarea
              class="{inputClassName} min-h-16 resize-y"
              maxlength={5000}
              placeholder={m.admin_sampleExplanationPlaceholder()}
              value={sample.explanation ?? ""}
              oninput={(e) => updateExplanation(index, (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
        </div>
      {/each}
    </div>
  {/if}

  <button
    type="button"
    class="{inputClassName} cursor-pointer text-center text-body-sm font-medium text-primary transition-[background-color] duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    disabled={samples.length >= MAX_SAMPLES}
    onclick={addSample}
  >
    {m.admin_addSample()}
  </button>
</div>
