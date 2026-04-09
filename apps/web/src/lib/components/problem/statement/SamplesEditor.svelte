<script lang="ts">
  import { inputClassName, monoTextareaClassName } from "$lib/utils";

  interface Sample {
    stdin: string;
    expected: string;
  }

  interface Props {
    samples: Sample[];
  }

  let { samples = $bindable([]) }: Props = $props();

  const MAX_SAMPLES = 5;

  function addSample() {
    if (samples.length >= MAX_SAMPLES) return;
    samples = [...samples, { stdin: "", expected: "" }];
  }

  function removeSample(index: number) {
    samples = samples.filter((_, i) => i !== index);
  }

  function updateStdin(index: number, value: string) {
    samples = samples.map((s, i) => (i === index ? { ...s, stdin: value } : s));
  }

  function updateExpected(index: number, value: string) {
    samples = samples.map((s, i) => (i === index ? { ...s, expected: value } : s));
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-sm font-semibold">Sample I/O</h3>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Samples are shown to students on the problem page. They do not count toward grading.
      </p>
    </div>
    <span class="text-xs text-muted-foreground">{samples.length} / {MAX_SAMPLES}</span>
  </div>

  {#if samples.length === 0}
    <div
      class="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
    >
      No samples yet. Add one to show students an example I/O pair.
    </div>
  {:else}
    <div class="space-y-3">
      {#each samples as sample, index (`sample-${index}`)}
        <div class="rounded-xl border border-border p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-muted-foreground">
              Sample {index + 1}
            </span>
            <button
              type="button"
              class="rounded text-xs text-muted-foreground transition hover:text-red-500"
              onclick={() => removeSample(index)}
              aria-label="Remove sample {index + 1}"
            >
              &times; Remove
            </button>
          </div>
          <div class="mt-2 grid gap-3 md:grid-cols-2">
            <label class="text-xs text-muted-foreground">
              <span>Input (stdin)</span>
              <textarea
                class="{monoTextareaClassName} min-h-24"
                value={sample.stdin}
                oninput={(e) => updateStdin(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
            <label class="text-xs text-muted-foreground">
              <span>Expected output</span>
              <textarea
                class="{monoTextareaClassName} min-h-24"
                value={sample.expected}
                oninput={(e) => updateExpected(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <button
    type="button"
    class="{inputClassName} cursor-pointer text-center text-sm font-medium text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    disabled={samples.length >= MAX_SAMPLES}
    onclick={addSample}
  >
    + Add sample
  </button>
</div>
