<script lang="ts">
  import { inputClassName, monoTextareaClassName } from "$lib/utils";

  /**
   * Per-case auxiliary files map. Keys are relative paths inside
   * /workspace/testcases/N/, values are file content (base64 for binary).
   */
  type FileBag = Record<string, string>;

  export interface AdvancedCase {
    stdin: string;
    expected: string;
    files: FileBag;
  }

  interface Props {
    cases: AdvancedCase[];
    onsave?: (cases: AdvancedCase[]) => void;
  }

  let { cases = $bindable<AdvancedCase[]>([]), onsave }: Props = $props();
  let saving = $state(false);

  function blank(): AdvancedCase {
    return { stdin: "", expected: "", files: {} };
  }

  function addCase() {
    cases = [...cases, blank()];
  }

  function removeCase(idx: number) {
    cases = cases.filter((_, i) => i !== idx);
  }

  function moveCase(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= cases.length) return;
    const next = [...cases];
    const [removed] = next.splice(idx, 1);
    if (removed === undefined) return;
    next.splice(target, 0, removed);
    cases = next;
  }

  async function readAsString(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Heuristic: if any null bytes, treat as binary and base64-encode.
    const isBinary = bytes.some((b) => b === 0);
    if (isBinary) {
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function attachFiles(idx: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = [...cases];
    const target = next[idx];
    if (!target) return;
    const bag: FileBag = { ...target.files };
    for (const file of Array.from(files)) {
      bag[file.name] = await readAsString(file);
    }
    next[idx] = { ...target, files: bag };
    cases = next;
  }

  function removeFile(idx: number, fileName: string) {
    const next = [...cases];
    const target = next[idx];
    if (!target) return;
    const bag: FileBag = { ...target.files };
    delete bag[fileName];
    next[idx] = { ...target, files: bag };
    cases = next;
  }

  function save() {
    saving = true;
    onsave?.(cases);
    setTimeout(() => {
      saving = false;
    }, 200);
  }
</script>

<section class="space-y-6">
  <header class="flex items-center justify-between">
    <div class="space-y-1">
      <h3 class="text-lg font-semibold">Testcases</h3>
      <p class="text-sm text-muted-foreground">
        Each case becomes a directory under
        <code>/workspace/testcases/N/</code> with stdin, optional expected
        output, and any auxiliary files you upload.
      </p>
    </div>
    <button
      type="button"
      class="rounded-full border border-border px-4 py-1.5 text-xs font-medium hover:bg-muted"
      onclick={addCase}
    >
      + Add case
    </button>
  </header>

  {#if cases.length === 0}
    <div
      class="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
    >
      No testcases yet. Click <strong>Add case</strong> to start.
    </div>
  {/if}

  <ol class="space-y-4">
    {#each cases as testcase, idx (idx)}
      <li class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-4">
        <div class="mb-3 flex items-center gap-2">
          <span class="text-sm font-semibold">Case #{idx}</span>
          <div class="ml-auto flex items-center gap-1">
            <button
              type="button"
              class="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-30"
              disabled={idx === 0}
              onclick={() => moveCase(idx, -1)}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              class="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-30"
              disabled={idx === cases.length - 1}
              onclick={() => moveCase(idx, 1)}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              class="rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              onclick={() => removeCase(idx)}
            >
              Remove
            </button>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm">
            <span class="text-xs font-medium text-muted-foreground">stdin</span>
            <textarea
              class={monoTextareaClassName}
              bind:value={testcase.stdin}
              rows="4"
            ></textarea>
          </label>
          <label class="text-sm">
            <span class="text-xs font-medium text-muted-foreground">
              expected (optional)
            </span>
            <textarea
              class={monoTextareaClassName}
              bind:value={testcase.expected}
              rows="4"
            ></textarea>
          </label>
        </div>

        <div class="mt-3">
          <span class="text-xs font-medium text-muted-foreground">
            Auxiliary files
          </span>
          <input
            type="file"
            multiple
            class={`${inputClassName} mt-1`}
            onchange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              attachFiles(idx, input.files);
            }}
          />
          {#if Object.keys(testcase.files).length > 0}
            <ul class="mt-2 space-y-1 text-xs">
              {#each Object.keys(testcase.files) as fileName (fileName)}
                <li class="flex items-center justify-between">
                  <code class="truncate">{fileName}</code>
                  <button
                    type="button"
                    class="text-red-600 hover:underline"
                    onclick={() => removeFile(idx, fileName)}
                  >
                    remove
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  <div class="flex justify-end">
    <button
      type="button"
      class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
      disabled={saving}
      onclick={save}
    >
      {saving ? "Saving…" : "Save testcases"}
    </button>
  </div>
</section>
