<script lang="ts">
  import { untrack } from "svelte";
  import type { ProblemDetail } from "$lib/types";
  import type { JudgeScriptLanguage, JudgeType } from "@nojv/core";
  import { inputClassName } from "$lib/utils/css";
  import { m } from "$lib/paraglide/messages.js";
  import MonacoScriptEditor from "$lib/components/features/problem/editors/MonacoScriptEditor.svelte";
  import UploadDropZone from "$lib/components/features/problem/admin/UploadDropZone.svelte";
  import { toasts } from "$lib/stores/toast";
  import {
    PYTHON_CHECKER_EXAMPLE,
    PYTHON_INTERACTOR_EXAMPLE,
    CPP_CHECKER_EXAMPLE,
    CPP_INTERACTOR_EXAMPLE,
  } from "./judge/script-examples";

  interface Props {
    problem: ProblemDetail;
    validatorScripts: { checkerScript: string; interactorScript: string };
    ondirtychange?: (dirty: boolean) => void;
    onuploaded?: () => void;
  }

  let { problem, validatorScripts, ondirtychange, onuploaded }: Props = $props();

  const cfg = untrack(() => problem.judgeConfig ?? {});

  let judgeType = $state<JudgeType>(cfg.type ?? "standard");

  let checkerScript = $state(untrack(() => validatorScripts.checkerScript));
  let checkerLanguage = $state<JudgeScriptLanguage>(cfg.checkerLanguage ?? "python");
  let interactorScript = $state(untrack(() => validatorScripts.interactorScript));
  let interactorLanguage = $state<JudgeScriptLanguage>(cfg.interactorLanguage ?? "python");

  function buildJudgeConfig() {
    const config: Record<string, unknown> = {
      type: judgeType,
    };

    if (judgeType === "checker") {
      config.checkerLanguage = checkerLanguage;
    } else if (judgeType === "interactive") {
      config.interactorLanguage = interactorLanguage;
    }

    if (cfg.runtime) {
      config.runtime = cfg.runtime;
    }

    return config;
  }

  function dirtySnapshot() {
    return JSON.stringify({
      config: buildJudgeConfig(),
      checkerScript,
      interactorScript,
    });
  }

  let initialConfig = $state(dirtySnapshot());
  let saving = $state(false);
  let saveMessage = $state("");

  $effect(() => {
    ondirtychange?.(dirtySnapshot() !== initialConfig);
  });

  async function handleSave() {
    saving = true;
    saveMessage = "";
    try {
      const formData = new FormData();
      formData.set("data", JSON.stringify(buildJudgeConfig()));
      if (judgeType === "checker") {
        formData.set("checkerScript", checkerScript);
      } else if (judgeType === "interactive") {
        formData.set("interactorScript", interactorScript);
      }
      const response = await fetch("?/updateJudgeConfig", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        saveMessage = "saved";
        initialConfig = dirtySnapshot();
      } else {
        saveMessage = "error";
      }
    } catch {
      saveMessage = "error";
    } finally {
      saving = false;
    }
  }

  let checkerExample = $derived(
    checkerLanguage === "python" ? PYTHON_CHECKER_EXAMPLE : CPP_CHECKER_EXAMPLE,
  );
  let interactorExample = $derived(
    interactorLanguage === "python" ? PYTHON_INTERACTOR_EXAMPLE : CPP_INTERACTOR_EXAMPLE,
  );

  function languageFromName(name: string): JudgeScriptLanguage | null {
    if (name.endsWith(".py")) return "python";
    if (name.endsWith(".cpp") || name.endsWith(".cc") || name.endsWith(".cxx")) return "cpp";
    return null;
  }

  async function uploadScript(kind: "checker" | "interactor", file: File) {
    const inferred = languageFromName(file.name.toLowerCase());
    const language = inferred ?? (kind === "checker" ? checkerLanguage : interactorLanguage);
    const form = new FormData();
    form.set("file", file);
    form.set("language", language);
    const res = await fetch(`/api/problems/${problem.id}/${kind}`, {
      method: "POST",
      headers: { "X-Requested-With": "fetch" },
      body: form,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(data?.message ?? m.bundle_uploadFailed());
    }
    const text = await file.text();
    if (kind === "checker") {
      checkerScript = text;
      checkerLanguage = language;
    } else {
      interactorScript = text;
      interactorLanguage = language;
    }
    initialConfig = dirtySnapshot();
    toasts.add({ message: m.bundle_uploadSuccess(), type: "success" });
    onuploaded?.();
  }
</script>

<div class="space-y-4">
  <div class="rounded-lg border border-border-subtle p-2">
    <h3 class="text-body-sm font-semibold">{m.admin_judgeType()}</h3>
    <p class="mt-0.5 text-caption text-muted-foreground">
      {m.admin_judgeTypeHint()}
    </p>

    <div class="mt-3 flex gap-4">
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          class="accent-primary"
          name="judgeType"
          value="standard"
          checked={judgeType === "standard"}
          onchange={() => (judgeType = "standard")}
        />
        <span>{m.admin_judgeStandard()}</span>
      </label>
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          class="accent-primary"
          name="judgeType"
          value="checker"
          checked={judgeType === "checker"}
          onchange={() => (judgeType = "checker")}
        />
        <span>{m.admin_judgeChecker()}</span>
      </label>
      <label class="flex items-center gap-2 text-body-sm">
        <input
          type="radio"
          class="accent-primary"
          name="judgeType"
          value="interactive"
          checked={judgeType === "interactive"}
          onchange={() => (judgeType = "interactive")}
        />
        <span>{m.admin_judgeInteractive()}</span>
      </label>
    </div>

    {#if judgeType === "standard"}
      <p class="mt-4 rounded-md bg-muted/50 px-3 py-2 text-caption text-muted-foreground">
        {m.admin_standardNormalizationHint()}
      </p>
    {:else if judgeType === "checker"}
      <div class="mt-4 space-y-3">
        <label class="text-caption text-muted-foreground">
          <span>{m.admin_scriptLanguage()}</span>
          <select
            class={inputClassName}
            value={checkerLanguage}
            onchange={(e) => {
              checkerLanguage = (e.target as HTMLSelectElement).value as JudgeScriptLanguage;
            }}
          >
            <option value="python">{m.common_language_python()}</option>
            <option value="cpp">{m.common_language_cpp()}</option>
          </select>
        </label>

        <details class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2">
          <summary class="cursor-pointer text-caption font-semibold">
            {m.admin_checkerHelpTitle()}
          </summary>
          <p class="mt-2 whitespace-pre-line text-caption text-muted-foreground">
            {m.admin_checkerHelpBody()}
          </p>
          <pre
            class="mt-2 overflow-x-auto rounded-md bg-[color:var(--color-panel)] p-3 font-mono text-caption"><code
              >{checkerExample}</code
            ></pre>
        </details>

        <UploadDropZone
          label={m.bundle_uploadCheckerLabel()}
          hint={m.bundle_uploadCheckerHint()}
          accept=".py,.cpp,.cc,.cxx"
          onupload={(f) => uploadScript("checker", f)}
        />

        <MonacoScriptEditor
          value={checkerScript}
          onchange={(v) => (checkerScript = v)}
          language={checkerLanguage}
          height="320px"
        />
      </div>
    {:else if judgeType === "interactive"}
      <div class="mt-4 space-y-3">
        <label class="text-caption text-muted-foreground">
          <span>{m.admin_interactorLanguage()}</span>
          <select
            class={inputClassName}
            value={interactorLanguage}
            onchange={(e) => {
              interactorLanguage = (e.target as HTMLSelectElement).value as JudgeScriptLanguage;
            }}
          >
            <option value="python">{m.common_language_python()}</option>
            <option value="cpp">{m.common_language_cpp()}</option>
          </select>
        </label>

        <details class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2">
          <summary class="cursor-pointer text-caption font-semibold">
            {m.admin_interactorHelpTitle()}
          </summary>
          <p class="mt-2 whitespace-pre-line text-caption text-muted-foreground">
            {m.admin_interactorHelpBody()}
          </p>
          <pre
            class="mt-2 overflow-x-auto rounded-md bg-[color:var(--color-panel)] p-3 font-mono text-caption"><code
              >{interactorExample}</code
            ></pre>
        </details>

        <UploadDropZone
          label={m.bundle_uploadInteractorLabel()}
          hint={m.bundle_uploadInteractorHint()}
          accept=".py,.cpp,.cc,.cxx"
          onupload={(f) => uploadScript("interactor", f)}
        />

        <MonacoScriptEditor
          value={interactorScript}
          onchange={(v) => (interactorScript = v)}
          language={interactorLanguage}
          height="320px"
        />
      </div>
    {/if}
  </div>

  <div class="mt-2 flex justify-end">
    <div class="flex items-center gap-3">
      <button
        class="inline-flex w-fit rounded-full bg-primary px-5 py-3 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={saving}
        type="button"
        onclick={() => void handleSave()}
      >
        {saving ? m.common_saving() : m.common_saveDraft()}
      </button>
      {#if saveMessage === "saved"}
        <span class="text-body-sm text-success">{m.admin_saved()}</span>
      {:else if saveMessage === "error"}
        <span class="text-body-sm text-destructive">{m.admin_saveFailed()}</span>
      {/if}
    </div>
  </div>
</div>
