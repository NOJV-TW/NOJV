<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { languageSchema, type Language } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import MonacoScriptEditor from "$lib/components/features/problem/editors/MonacoScriptEditor.svelte";
  import {
    buildSubmissionRequest,
    workspaceDraftKey,
    type WorkspaceFile,
  } from "$lib/components/features/problem/editors/editor-bindings";
  import { executeSubmission } from "$lib/services/submission-service";
  import { toasts } from "$lib/stores/toast";

  interface SourceFile {
    path: string;
    content: string;
  }

  interface ReferenceState {
    status: "not_configured" | "validating" | "verified" | "failed";
    language: string | null;
    sourceFiles: SourceFile[];
  }

  interface Props {
    problemId: string;
    problemType: "full_source" | "multi_file";
    initial: ReferenceState;
    starterByLanguage: Record<string, string>;
    workspaceFiles: WorkspaceFile[];
  }

  let { problemId, problemType, initial, starterByLanguage, workspaceFiles }: Props = $props();

  function resolveInitialLanguage(): Language {
    if (problemType === "multi_file") {
      const candidate =
        workspaceFiles.find((file) => file.visibility === "editable")?.language ??
        workspaceFiles[0]?.language;
      return languageSchema.safeParse(candidate).data ?? "python";
    }
    return (
      languageSchema.safeParse(initial.language).data ??
      languageSchema.safeParse(
        workspaceFiles.find((f) => f.visibility === "editable")?.language,
      ).data ??
      "python"
    );
  }

  let language = $state<Language>(resolveInitialLanguage());
  let fullDrafts = $state<Record<string, string>>({});
  let workspaceDrafts = $state<Record<string, string>>({});
  let selectedIndex = $state(0);
  let status = $state<ReferenceState["status"]>("not_configured");
  let isSubmitting = $state(false);
  let initialized = $state(false);

  const workspaceLanguages = $derived([
    ...new Set(workspaceFiles.map((file) => file.language)),
  ]);
  const visibleFiles = $derived(
    workspaceFiles.filter((file) => file.language === language && file.visibility !== "hidden"),
  );
  const selectedFile = $derived(visibleFiles[selectedIndex]);

  function sourceForPath(path: string): string | undefined {
    return initial.sourceFiles.find((file) => file.path === path)?.content;
  }

  function ensureDrafts() {
    if (fullDrafts[language] === undefined) {
      const verifiedLanguage = languageSchema.safeParse(initial.language).data;
      fullDrafts[language] =
        (verifiedLanguage === language ? initial.sourceFiles[0]?.content : undefined) ??
        starterByLanguage[language] ??
        "";
    }
    for (const file of visibleFiles) {
      const key = workspaceDraftKey(file.language, file.path);
      if (workspaceDrafts[key] === undefined) {
        workspaceDrafts[key] = sourceForPath(file.path) ?? file.content;
      }
    }
  }

  $effect(() => {
    if (!initialized) {
      status = initial.status;
      initialized = true;
    }
    const fileCount = visibleFiles.length;
    const currentLanguage = language;
    ensureDrafts();
    if (currentLanguage && selectedIndex >= fileCount) selectedIndex = 0;
  });

  function selectedContent(): string {
    if (!selectedFile) return "";
    return workspaceDrafts[workspaceDraftKey(selectedFile.language, selectedFile.path)] ?? "";
  }

  async function submitReference() {
    if (isSubmitting) return;
    ensureDrafts();
    isSubmitting = true;
    status = "validating";
    let accepted = false;
    try {
      const request = buildSubmissionRequest({
        context: { type: "practice" },
        drafts: fullDrafts,
        isWorkspaceMode: problemType === "multi_file",
        language,
        problemId,
        referenceSolution: true,
        sampleOnly: false,
        workspaceDrafts,
        workspaceFiles: visibleFiles,
      });
      const result = await executeSubmission(request);
      if (!result) {
        status = "failed";
        return;
      }
      accepted = result.accepted;
      status = accepted ? "verified" : "failed";
      if (!accepted) toasts.error(result.feedback);
    } catch (error) {
      status = "failed";
      toasts.error(error instanceof Error ? error.message : m.error_unexpected());
    } finally {
      isSubmitting = false;
    }
    if (!accepted) return;
    try {
      await invalidateAll();
    } catch {
      toasts.error(m.admin_referenceRefreshFailed());
    }
  }

  function statusText(): string {
    if (status === "verified") return m.admin_referenceVerified();
    if (status === "validating") return m.admin_referenceValidating();
    if (status === "failed") return m.admin_referenceFailed();
    return m.admin_referenceNotConfigured();
  }
</script>

<section
  class="space-y-4 rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <div>
    <h2 class="text-body-lg font-semibold">{m.admin_referenceTitle()}</h2>
    <p class="mt-1 text-body-sm text-muted-foreground">{m.admin_referenceDescription()}</p>
  </div>

  {#if problemType === "multi_file" && workspaceLanguages.length > 0}
    <label class="grid gap-1.5 text-body-sm text-muted-foreground">
      <span>{m.admin_referenceLanguage()}</span>
      <select
        class="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm"
        bind:value={language}
      >
        {#each workspaceLanguages as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>
  {/if}

  <div
    class="rounded-lg border px-3 py-2 text-body-sm {status === 'verified'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'validating'
        ? 'border-info/40 bg-info/10 text-info'
        : status === 'failed'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border-subtle text-muted-foreground'}"
    role="status"
  >
    {statusText()}
  </div>

  {#if problemType === "full_source"}
    <div class="grid gap-3">
      <label class="grid gap-1.5 text-body-sm text-muted-foreground">
        <span>{m.admin_referenceLanguage()}</span>
        <select
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm"
          bind:value={language}
        >
          {#each languageSchema.options as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </label>
      <div class="h-[440px] overflow-hidden rounded-lg border border-border-subtle">
        <MonacoScriptEditor
          value={fullDrafts[language] ?? ""}
          {language}
          height="100%"
          onchange={(value) => (fullDrafts[language] = value)}
        />
      </div>
    </div>
  {:else if visibleFiles.length > 0}
    <div class="grid min-h-[440px] gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
      <div class="rounded-lg border border-border-subtle p-2">
        <p
          class="px-2 py-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {m.admin_files()}
        </p>
        <div class="space-y-1">
          {#each visibleFiles as file, index (`${file.language}::${file.path}`)}
            <button
              type="button"
              class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-caption transition-colors duration-fast ease-out-soft {selectedIndex ===
              index
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent'}"
              onclick={() => (selectedIndex = index)}
            >
              <span class="truncate font-mono">{file.path}</span>
              {#if file.visibility === "readonly"}
                <span class="ml-2 shrink-0">🔒</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
      {#if selectedFile}
        <div class="min-h-0 overflow-hidden rounded-lg border border-border-subtle">
          {#if selectedFile.visibility === "readonly"}
            <p
              class="border-b border-border-subtle px-3 py-2 text-caption text-muted-foreground"
            >
              {m.admin_referenceReadonly()}
            </p>
          {/if}
          <MonacoScriptEditor
            value={selectedContent()}
            language={selectedFile.language}
            isReadOnly={selectedFile.visibility === "readonly"}
            height="100%"
            onchange={(value) => {
              if (selectedFile?.visibility === "editable") {
                workspaceDrafts[workspaceDraftKey(selectedFile.language, selectedFile.path)] =
                  value;
              }
            }}
          />
        </div>
      {/if}
    </div>
  {:else}
    <p
      class="rounded-lg border border-dashed border-border-subtle p-6 text-center text-body-sm text-muted-foreground"
    >
      {m.admin_workspaceNoLanguagesSelected()}
    </p>
  {/if}

  <div class="flex justify-end">
    <button
      type="button"
      class="rounded-full bg-primary px-4 py-2 text-body-sm font-semibold text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSubmitting || (problemType === "multi_file" && visibleFiles.length === 0)}
      onclick={() => void submitReference()}
    >
      {isSubmitting ? m.admin_referenceSubmitting() : m.admin_referenceSubmit()}
    </button>
  </div>
</section>
