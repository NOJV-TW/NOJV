<script lang="ts">
  import { untrack } from "svelte";
  import type { ProblemDetail } from "$lib/types";
  import type { CompareMode, JudgeScriptLanguage, JudgeType } from "@nojv/core";
  import { inputClassName } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import MonacoScriptEditor from "$lib/components/problem/editors/MonacoScriptEditor.svelte";

  interface Props {
    problem: ProblemDetail;
    testcaseSets?: { id: string; name: string; weight: number }[];
    ondirtychange?: (dirty: boolean) => void;
  }

  let { problem, testcaseSets = [], ondirtychange }: Props = $props();

  // Seed state from the current judgeConfig snapshot.
  const cfg = untrack(() => problem.judgeConfig ?? {});

  let judgeType = $state<JudgeType>(cfg.type ?? "standard");

  // Compare mode.
  let compareMode = $state<CompareMode>(cfg.compare?.mode ?? "exact");
  let floatAbsTol = $state(cfg.compare?.floatAbsTol ?? 1e-6);
  let floatRelTol = $state(cfg.compare?.floatRelTol ?? 0);
  let ignoreLinePatternsText = $state(
    (cfg.compare?.ignoreLinePatterns ?? []).join("\n")
  );

  // Checker + interactor.
  let checkerScript = $state(cfg.checkerScript ?? "");
  let checkerLanguage = $state<JudgeScriptLanguage>(cfg.checkerLanguage ?? "python");
  let interactorScript = $state(cfg.interactorScript ?? "");
  let interactorLanguage = $state<JudgeScriptLanguage>(
    cfg.interactorLanguage ?? "python"
  );

  // Subtask scoring.
  let subtaskStrategies = $state<Record<string, "all_or_nothing" | "proportional" | "minimum">>(
    (cfg.scoring?.subtaskStrategies as Record<
      string,
      "all_or_nothing" | "proportional" | "minimum"
    > | undefined) ?? {}
  );

  // ─── Save ──────────────────────────────────────────────────────────
  function buildJudgeConfig() {
    const config: Record<string, unknown> = {
      type: judgeType
    };

    if (judgeType === "standard") {
      const compare: Record<string, unknown> = { mode: compareMode };
      if (compareMode === "float") {
        compare.floatAbsTol = floatAbsTol;
        compare.floatRelTol = floatRelTol;
      }
      if (compareMode === "regex_filter") {
        const lines = ignoreLinePatternsText
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "");
        compare.ignoreLinePatterns = lines;
      }
      config.compare = compare;
    } else if (judgeType === "checker") {
      config.checkerScript = checkerScript;
      config.checkerLanguage = checkerLanguage;
    } else if (judgeType === "interactive") {
      config.interactorScript = interactorScript;
      config.interactorLanguage = interactorLanguage;
    }

    // Preserve runtime from the existing config — WorkspaceSection owns
    // it, so Judge should not clobber it.
    if (cfg.runtime) {
      config.runtime = cfg.runtime;
    }

    config.scoring = { subtaskStrategies };

    return config;
  }

  let initialConfig = $state(JSON.stringify(buildJudgeConfig()));
  let saving = $state(false);
  let saveMessage = $state("");

  $effect(() => {
    const current = JSON.stringify(buildJudgeConfig());
    ondirtychange?.(current !== initialConfig);
  });

  async function handleSave() {
    saving = true;
    saveMessage = "";
    try {
      const data = buildJudgeConfig();
      const formData = new FormData();
      formData.set("data", JSON.stringify(data));
      const response = await fetch("?/updateJudgeConfig", {
        method: "POST",
        body: formData
      });
      if (response.ok) {
        saveMessage = "saved";
        initialConfig = JSON.stringify(buildJudgeConfig());
      } else {
        saveMessage = "error";
      }
    } catch {
      saveMessage = "error";
    } finally {
      saving = false;
    }
  }

  let formulaPreview = $derived.by(() => {
    if (testcaseSets.length === 0) return "";
    const parts = testcaseSets
      .filter((s) => s.weight > 0)
      .map((s) => {
        const strategy = subtaskStrategies[s.id] ?? "all_or_nothing";
        const label =
          strategy === "all_or_nothing"
            ? "all-or-nothing"
            : strategy === "proportional"
              ? "proportional"
              : "minimum";
        return `${s.name}(${String(s.weight)}pts, ${label})`;
      });
    return parts.join(" + ");
  });
</script>

<div class="space-y-4">
  <!-- ─── Judge Type ───────────────────────── -->
  <div class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">Judge type</h3>
    <p class="mt-0.5 text-caption text-muted-foreground">
      How each testcase is evaluated.
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
        <span>Standard (stdin/stdout diff)</span>
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
        <span>Checker script</span>
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
        <span>Interactive</span>
      </label>
    </div>

    <!-- Standard: compare mode -->
    {#if judgeType === "standard"}
      <div class="mt-4 space-y-3">
        <label class="text-caption text-muted-foreground">
          <span>Compare mode</span>
          <select
            class={inputClassName}
            value={compareMode}
            onchange={(e) => {
              compareMode = (e.target as HTMLSelectElement).value as CompareMode;
            }}
          >
            <option value="exact">Exact diff</option>
            <option value="ignore_whitespace">Ignore whitespace</option>
            <option value="ignore_case">Ignore case</option>
            <option value="float">Float tolerance</option>
            <option value="regex_filter">Regex line filter</option>
          </select>
        </label>

        {#if compareMode === "float"}
          <div class="grid gap-3 md:grid-cols-2">
            <label class="text-caption text-muted-foreground">
              <span>Absolute tolerance</span>
              <input
                class={inputClassName}
                type="number"
                step="any"
                bind:value={floatAbsTol}
              />
            </label>
            <label class="text-caption text-muted-foreground">
              <span>Relative tolerance</span>
              <input
                class={inputClassName}
                type="number"
                step="any"
                bind:value={floatRelTol}
              />
            </label>
          </div>
        {:else if compareMode === "regex_filter"}
          <label class="text-caption text-muted-foreground">
            <span>Ignore lines matching (one regex per line)</span>
            <textarea
              class="{inputClassName} min-h-20 font-mono text-caption"
              placeholder={"^Please enter.*\n^> .*"}
              bind:value={ignoreLinePatternsText}
            ></textarea>
          </label>
        {/if}
      </div>
    {:else if judgeType === "checker"}
      <div class="mt-4 space-y-3">
        <label class="text-caption text-muted-foreground">
          <span>Language</span>
          <select
            class={inputClassName}
            value={checkerLanguage}
            onchange={(e) => {
              checkerLanguage = (e.target as HTMLSelectElement)
                .value as JudgeScriptLanguage;
            }}
          >
            <option value="python">Python</option>
            <option value="bash">Bash</option>
            <option value="node">Node.js</option>
            <option value="c">C</option>
            <option value="cpp">C++</option>
          </select>
        </label>
        <MonacoScriptEditor
          value={checkerScript}
          onchange={(v) => (checkerScript = v)}
          language={checkerLanguage === "node" ? "javascript" : checkerLanguage}
          height="320px"
        />
      </div>
    {:else if judgeType === "interactive"}
      <div class="mt-4 space-y-3">
        <label class="text-caption text-muted-foreground">
          <span>Interactor language</span>
          <select
            class={inputClassName}
            value={interactorLanguage}
            onchange={(e) => {
              interactorLanguage = (e.target as HTMLSelectElement)
                .value as JudgeScriptLanguage;
            }}
          >
            <option value="python">Python</option>
            <option value="bash">Bash</option>
            <option value="node">Node.js</option>
            <option value="c">C</option>
            <option value="cpp">C++</option>
          </select>
        </label>
        <MonacoScriptEditor
          value={interactorScript}
          onchange={(v) => (interactorScript = v)}
          language={interactorLanguage === "node" ? "javascript" : interactorLanguage}
          height="320px"
        />
      </div>
    {/if}
  </div>

  <!-- ─── Subtask Scoring ───────────────────── -->
  <div class="rounded-xl border border-border-subtle p-4">
    <h3 class="text-body-sm font-semibold">Subtask scoring</h3>
    <p class="mt-0.5 text-caption text-muted-foreground">
      How each graded set contributes to the final score.
    </p>

    {#if testcaseSets.filter((s) => s.weight > 0).length === 0}
      <p class="mt-3 text-body-sm text-muted-foreground">
        No graded testcase sets yet. Create one in the Testcases tab.
      </p>
    {:else}
      <div class="mt-3 space-y-2">
        {#each testcaseSets.filter((s) => s.weight > 0) as set (set.id)}
          <div class="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2">
            <span class="text-body-sm font-medium">{set.name}</span>
            <span class="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary tabular-nums">
              {set.weight} pts
            </span>
            <select
              class="{inputClassName} mt-0 ml-auto w-40"
              value={subtaskStrategies[set.id] ?? "all_or_nothing"}
              onchange={(e) => {
                subtaskStrategies = {
                  ...subtaskStrategies,
                  [set.id]: (e.target as HTMLSelectElement).value as
                    | "all_or_nothing"
                    | "proportional"
                    | "minimum"
                };
              }}
            >
              <option value="all_or_nothing">All-or-nothing</option>
              <option value="proportional">Proportional</option>
              <option value="minimum">Minimum</option>
            </select>
          </div>
        {/each}
      </div>

      {#if formulaPreview}
        <div class="mt-3 rounded-lg bg-muted/50 px-3 py-2">
          <span class="text-caption text-muted-foreground">Total score = </span>
          <span class="text-caption font-mono">{formulaPreview}</span>
        </div>
      {/if}
    {/if}
  </div>

  <!-- ─── Save ──────────────────────────────── -->
  <div class="mt-2 flex justify-end">
    <div class="flex items-center gap-3">
      <button
        class="inline-flex w-fit rounded-full bg-primary px-5 py-3 text-body-sm font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={saving}
        type="button"
        onclick={() => void handleSave()}
      >
        {saving ? m.common_saving() : m.common_saveSettings()}
      </button>
      {#if saveMessage === "saved"}
        <span class="text-body-sm text-success">{m.admin_saved()}</span>
      {:else if saveMessage === "error"}
        <span class="text-body-sm text-destructive">{m.admin_saveFailed()}</span>
      {/if}
    </div>
  </div>
</div>
