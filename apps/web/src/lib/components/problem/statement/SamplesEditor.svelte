<script lang="ts">
  import { inputClassName, monoTextareaClassName } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";

  interface Sample {
    input: string;
    output: string;
  }

  interface Props {
    samples: Sample[];
  }

  let { samples = $bindable([]) }: Props = $props();

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
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-body-sm font-semibold">{m.admin_sampleIO()}</h3>
      <p class="mt-0.5 text-caption text-muted-foreground">
        {m.admin_sampleIOHint()}
      </p>
    </div>
    <span class="text-caption text-muted-foreground tabular-nums">{samples.length} / {MAX_SAMPLES}</span>
  </div>

  {#if samples.length === 0}
    <div
      class="rounded-lg border border-dashed border-border-subtle p-4 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_noSamplesYet()}
    </div>
  {:else}
    <div class="space-y-3">
      {#each samples as sample, index (`sample-${index}`)}
        <div class="rounded-lg border border-border-subtle p-3">
          <div class="flex items-center justify-between">
            <span class="text-caption font-semibold text-muted-foreground">
              {m.admin_sampleNumber({ number: index + 1 })}
            </span>
            <button
              type="button"
              class="rounded text-caption text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-destructive"
              onclick={() => removeSample(index)}
              aria-label={m.admin_removeSample()}
            >
              &times; {m.admin_removeSample()}
            </button>
          </div>
          <div class="mt-2 grid gap-3 md:grid-cols-2">
            <label class="text-caption text-muted-foreground">
              <span>{m.admin_sampleInput()}</span>
              <textarea
                class="{monoTextareaClassName} min-h-24"
                value={sample.input}
                oninput={(e) => updateInput(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
            <label class="text-caption text-muted-foreground">
              <span>{m.admin_sampleOutput()}</span>
              <textarea
                class="{monoTextareaClassName} min-h-24"
                value={sample.output}
                oninput={(e) => updateOutput(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          </div>
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
