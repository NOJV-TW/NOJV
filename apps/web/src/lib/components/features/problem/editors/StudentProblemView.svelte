<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { ProblemDetail } from "$lib/types";
  import MonacoScriptEditor from "./MonacoScriptEditor.svelte";

  type WorkspaceFile = ProblemDetail["workspaceFiles"][number];

  interface Props {
    files: WorkspaceFile[];
    selectedIndex: number;
    selectedContent: string;
    onselect: (index: number) => void;
    onfilechange: (value: string) => void;
  }

  let { files, selectedIndex, selectedContent, onselect, onfilechange }: Props = $props();

  let filesWidth = $state(220);
  let layoutContainer: HTMLDivElement | null = $state(null);
  let isResizing = $state(false);

  function startFilesResize(e: MouseEvent) {
    e.preventDefault();
    const container = layoutContainer;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const next = ev.clientX - rect.left;
      filesWidth = Math.max(120, Math.min(rect.width * 0.7, next));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      isResizing = false;
    };

    isResizing = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  let selectedFile = $derived<WorkspaceFile | undefined>(files[selectedIndex]);
</script>

<div bind:this={layoutContainer} class="absolute inset-0 flex">
  <aside
    class="shrink-0 overflow-y-auto bg-[color:var(--color-panel)] p-2"
    style="width: {filesWidth}px"
  >
    <p
      class="mb-2 px-2 pt-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {m.workspace_filesHeading()}
    </p>
    <ul class="space-y-0.5">
      {#each files as file, index (`${file.language}::${file.path}`)}
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between px-2 py-1.5 text-left text-body-sm transition-[background-color,color] duration-fast ease-out-soft hover:bg-accent {selectedIndex ===
            index
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground'}"
            onclick={() => onselect(index)}
          >
            <span class="truncate font-mono text-caption">
              {#if file.visibility === "hidden"}🔒
              {/if}{file.path}
            </span>
            <span
              class="ml-2 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide {file.visibility ===
              'editable'
                ? 'bg-success/15 text-success'
                : file.visibility === 'hidden'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-muted text-muted-foreground'}"
            >
              {file.visibility === "editable"
                ? m.workspace_visibilityEditable()
                : file.visibility === "hidden"
                  ? m.workspace_visibilityHidden()
                  : m.workspace_visibilityReadonly()}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </aside>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="group flex w-2 shrink-0 cursor-col-resize items-stretch justify-center outline-none"
    role="separator"
    aria-orientation="vertical"
    aria-label={m.common_resizeFilesPanel()}
    tabindex="0"
    onmousedown={startFilesResize}
    onkeydown={(e) => {
      if (e.key === "ArrowLeft") filesWidth = Math.max(120, filesWidth - 16);
      if (e.key === "ArrowRight") filesWidth = Math.min(600, filesWidth + 16);
    }}
  >
    <span
      aria-hidden="true"
      class="w-px transition-colors duration-fast {isResizing
        ? 'bg-primary'
        : 'bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary/60'}"
    ></span>
  </div>
  <div class="flex min-w-0 flex-1 flex-col">
    {#if selectedFile}
      {@const file = selectedFile}
      {#if file.visibility !== "hidden" && file.description !== ""}
        <p class="border-b border-border-subtle px-3 py-2 text-caption text-muted-foreground">
          {file.description}
        </p>
      {/if}
      <div class="min-h-0 flex-1">
        {#if file.visibility === "hidden"}
          <div class="flex h-full flex-col gap-3 overflow-y-auto px-6 py-6">
            <h3 class="text-body-sm font-semibold text-foreground">
              {m.workspace_fileHidden()}
            </h3>
            {#if file.description !== ""}
              <div
                class="max-w-prose whitespace-pre-wrap border border-border-subtle bg-muted/40 px-4 py-3 text-body-sm text-muted-foreground"
              >
                {file.description}
              </div>
            {:else}
              <p class="text-body-sm text-muted-foreground/70 italic">
                {m.workspace_fileHiddenNoDescription()}
              </p>
            {/if}
          </div>
        {:else}
          {#key `${file.language}::${file.path}`}
            <MonacoScriptEditor
              value={selectedContent}
              onchange={onfilechange}
              language={file.language}
              isReadOnly={file.visibility === "readonly"}
              height="100%"
            />
          {/key}
        {/if}
      </div>
    {/if}
  </div>
</div>
