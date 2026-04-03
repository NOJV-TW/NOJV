<script lang="ts">
  import type { ProblemDetail } from "$lib/types";
  import { inputClassName } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import MonacoScriptEditor from "$lib/components/problem/editors/MonacoScriptEditor.svelte";
  import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
  import TagInput from "$lib/components/ui/TagInput.svelte";
  import type { JudgeType } from "@nojv/core";

  interface Props {
    problem: ProblemDetail;
  }

  let { problem }: Props = $props();

  // ─── State derived from problem.judgeConfig ─────────────────────────
  const cfg = problem.judgeConfig ?? {};

  // Section 1: Judge Type
  let judgeType = $state<JudgeType>(cfg.type ?? "standard");
  let checkerScript = $state(cfg.checkerScript ?? "");
  let checkerLanguage = $state("python");
  let interactorScript = $state(cfg.interactorScript ?? "");
  let interactorLanguage = $state("python");

  // Section 2: Static Analysis
  let staticAnalysisEnabled = $state(!!cfg.staticAnalysis);
  let bannedFunctions = $state<string[]>(cfg.staticAnalysis?.bannedFunctions ?? []);
  let bannedImports = $state<string[]>(cfg.staticAnalysis?.bannedImports ?? []);
  let bannedPatterns = $state<{ pattern: string; isRegex: boolean; message: string }[]>(
    cfg.staticAnalysis?.bannedPatterns ?? []
  );
  let linterCommand = $state((cfg.staticAnalysis?.linterCommand ?? []).join(" "));
  let failOnLintError = $state(cfg.staticAnalysis?.failOnLintError ?? true);

  // Section 3: Artifact Collection
  let artifactsEnabled = $state(!!cfg.artifacts);
  let artifactPatterns = $state<string[]>(cfg.artifacts?.patterns ?? []);
  let artifactMaxSizeMb = $state(
    Math.round((cfg.artifacts?.maxTotalSizeBytes ?? 10_000_000) / 1_000_000)
  );

  // Section 4: Network Access
  let networkEnabled = $state(cfg.networkAccess?.enabled ?? false);
  let firewallRules = $state<{ allow: string; ports: string; protocol: string }[]>(
    (cfg.networkAccess?.firewallRules ?? []).map((r) => ({
      allow: r.allow,
      ports: (r.ports ?? []).join(", "),
      protocol: r.protocol ?? "tcp",
    }))
  );
  let sidecarServices = $state<{
    image: string; port: number; env: Record<string, string>;
    readinessPath: string; memoryMb: number;
  }[]>(
    (cfg.networkAccess?.sidecarServices ?? []).map((s) => ({
      image: s.image,
      port: s.port,
      env: s.env ?? {},
      readinessPath: s.readinessPath ?? "",
      memoryMb: s.memoryMb ?? 128,
    }))
  );
  let logTraffic = $state(cfg.networkAccess?.logTraffic ?? true);

  // Section 5: Custom Pipeline Stages
  let customScriptsEnabled = $state((cfg.customScripts ?? []).length > 0);
  let customScripts = $state<{
    name: string; runAt: string; language: string; script: string;
  }[]>(
    (cfg.customScripts ?? []).map((s) => ({
      name: s.name,
      runAt: s.runAt ?? "after-check",
      language: s.language ?? "python",
      script: s.script,
    }))
  );

  // ─── Default templates ───────────────────────────────────────────────
  const defaultCheckerTemplate = `import sys

input_data = open(sys.argv[1]).read()
expected = open(sys.argv[2]).read()
actual = open(sys.argv[3]).read()

if actual.strip() == expected.strip():
    print("AC")
    sys.exit(0)
else:
    print("WA")
    sys.exit(1)
`;

  const defaultInteractorTemplate = `import sys

# Read from stdin (contestant output), write to stdout (contestant input)
t = int(input())
print(t)
sys.stdout.flush()
`;

  // ─── Save ────────────────────────────────────────────────────────────
  let saving = $state(false);
  let saveMessage = $state("");

  function buildJudgeConfig() {
    const config: Record<string, unknown> = {
      type: judgeType,
    };

    if (judgeType === "checker" && checkerScript) {
      config.checkerScript = checkerScript;
    }
    if (judgeType === "interactive" && interactorScript) {
      config.interactorScript = interactorScript;
    }

    if (staticAnalysisEnabled) {
      config.staticAnalysis = {
        bannedFunctions,
        bannedImports,
        bannedPatterns,
        linterCommand: linterCommand.trim() ? linterCommand.trim().split(/\s+/) : undefined,
        failOnLintError,
      };
    }

    if (artifactsEnabled && artifactPatterns.length > 0) {
      config.artifacts = {
        patterns: artifactPatterns,
        maxTotalSizeBytes: artifactMaxSizeMb * 1_000_000,
      };
    }

    if (networkEnabled) {
      config.networkAccess = {
        enabled: true,
        firewallRules: firewallRules.map((r) => ({
          allow: r.allow,
          ports: r.ports
            .split(",")
            .map((p) => parseInt(p.trim(), 10))
            .filter((n) => !isNaN(n)),
          protocol: r.protocol,
        })),
        sidecarServices: sidecarServices.map((s) => ({
          image: s.image,
          port: s.port,
          env: s.env,
          readinessPath: s.readinessPath || undefined,
          memoryMb: s.memoryMb,
        })),
        logTraffic,
      };
    }

    if (customScriptsEnabled && customScripts.length > 0) {
      config.customScripts = customScripts.map((s) => ({
        name: s.name,
        script: s.script,
        language: s.language,
        runAt: s.runAt,
      }));
    }

    return config;
  }

  async function handleSave() {
    saving = true;
    saveMessage = "";
    try {
      const data = buildJudgeConfig();
      const formData = new FormData();
      formData.set("data", JSON.stringify(data));
      const response = await fetch("?/updateJudgeConfig", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        saveMessage = "saved";
      } else {
        saveMessage = "error";
      }
    } catch {
      saveMessage = "error";
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-4">
  <!-- Section 1: Judge Type -->
  <div class="rounded-2xl border border-border p-4">
    <h3 class="text-sm font-medium">{m.admin_judgeTypeHeading()}</h3>
    <div class="mt-3 flex items-center gap-4">
      <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="radio"
          name="judgeType"
          value="standard"
          checked={judgeType === "standard"}
          onchange={() => (judgeType = "standard")}
          class="accent-primary"
        />
        {m.admin_standardCompare()}
      </label>
      <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="radio"
          name="judgeType"
          value="checker"
          checked={judgeType === "checker"}
          onchange={() => (judgeType = "checker")}
          class="accent-primary"
        />
        Checker
      </label>
      <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="radio"
          name="judgeType"
          value="interactive"
          checked={judgeType === "interactive"}
          onchange={() => (judgeType = "interactive")}
          class="accent-primary"
        />
        Interactive
      </label>
    </div>

    {#if judgeType === "checker"}
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-3">
          <label class="text-sm text-muted-foreground">
            {m.admin_language()}
            <select
              class="{inputClassName} mt-0 inline-block w-auto"
              bind:value={checkerLanguage}
            >
              <option value="python">Python</option>
              <option value="cpp">C++</option>
            </select>
          </label>
          <button
            class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            type="button"
            onclick={() => { checkerScript = defaultCheckerTemplate; checkerLanguage = "python"; }}
          >
            {m.admin_loadDefaultTemplate()}
          </button>
        </div>
        <MonacoScriptEditor
          value={checkerScript}
          onchange={(v) => (checkerScript = v)}
          language={checkerLanguage}
        />
      </div>
    {/if}

    {#if judgeType === "interactive"}
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-3">
          <label class="text-sm text-muted-foreground">
            {m.admin_language()}
            <select
              class="{inputClassName} mt-0 inline-block w-auto"
              bind:value={interactorLanguage}
            >
              <option value="python">Python</option>
              <option value="cpp">C++</option>
            </select>
          </label>
          <button
            class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            type="button"
            onclick={() => { interactorScript = defaultInteractorTemplate; interactorLanguage = "python"; }}
          >
            {m.admin_loadDefaultTemplate()}
          </button>
        </div>
        <MonacoScriptEditor
          value={interactorScript}
          onchange={(v) => (interactorScript = v)}
          language={interactorLanguage}
        />
      </div>
    {/if}
  </div>

  <!-- Section 2: Static Analysis -->
  <div class="rounded-2xl border border-border p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">{m.admin_staticAnalysis()}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{m.admin_staticAnalysisDesc()}</p>
      </div>
      <ToggleSwitch bind:checked={staticAnalysisEnabled} />
    </div>
    {#if staticAnalysisEnabled}
      <div class="mt-4 space-y-3">
        <!-- Banned Functions -->
        <div class="text-sm text-muted-foreground">
          <span>{m.admin_bannedFunctions()}</span>
          <div class="mt-1">
            <TagInput bind:tags={bannedFunctions} placeholder={m.admin_bannedFunctionsPlaceholder()} />
          </div>
        </div>

        <!-- Banned Imports -->
        <div class="text-sm text-muted-foreground">
          <span>{m.admin_bannedImports()}</span>
          <div class="mt-1">
            <TagInput bind:tags={bannedImports} placeholder={m.admin_bannedImportsPlaceholder()} />
          </div>
        </div>

        <!-- Banned Patterns -->
        <div class="text-sm text-muted-foreground">
          <span>{m.admin_bannedPatterns()}</span>
          {#each bannedPatterns as bp, index (`bp-${String(index)}`)}
            <div class="mt-1 flex items-center gap-2">
              <input
                class="{inputClassName} mt-0 flex-1"
                placeholder="Pattern"
                value={bp.pattern}
                oninput={(e) => {
                  bannedPatterns = bannedPatterns.map((p, i) =>
                    i === index ? { ...p, pattern: (e.target as HTMLInputElement).value } : p
                  );
                }}
              />
              <label class="inline-flex items-center gap-1 text-xs whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={bp.isRegex}
                  onchange={() => {
                    bannedPatterns = bannedPatterns.map((p, i) =>
                      i === index ? { ...p, isRegex: !p.isRegex } : p
                    );
                  }}
                  class="accent-primary"
                />
                Regex
              </label>
              <input
                class="{inputClassName} mt-0 flex-1"
                placeholder={m.admin_patternMessage()}
                value={bp.message}
                oninput={(e) => {
                  bannedPatterns = bannedPatterns.map((p, i) =>
                    i === index ? { ...p, message: (e.target as HTMLInputElement).value } : p
                  );
                }}
              />
              <button
                class="text-muted-foreground hover:text-red-500"
                type="button"
                onclick={() => (bannedPatterns = bannedPatterns.filter((_, i) => i !== index))}
              >
                &times;
              </button>
            </div>
          {/each}
          <button
            class="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            type="button"
            onclick={() => (bannedPatterns = [...bannedPatterns, { pattern: "", isRegex: false, message: "" }])}
          >
            {m.admin_addPattern()}
          </button>
        </div>

        <!-- Linter Command -->
        <label class="text-sm text-muted-foreground">
          {m.admin_linterCommand()}
          <input
            class={inputClassName}
            bind:value={linterCommand}
            placeholder={m.admin_linterPlaceholder()}
          />
        </label>

        <!-- On Lint Failure -->
        <div class="text-sm text-muted-foreground">
          {m.admin_onLintFailure()}
          <div class="mt-1 flex items-center gap-4">
            <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="lintFailure"
                checked={failOnLintError}
                onchange={() => (failOnLintError = true)}
                class="accent-primary"
              />
              {m.admin_failSubmission()}
            </label>
            <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="lintFailure"
                checked={!failOnLintError}
                onchange={() => (failOnLintError = false)}
                class="accent-primary"
              />
              {m.admin_warnOnly()}
            </label>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Section 3: Artifact Collection -->
  <div class="rounded-2xl border border-border p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">{m.admin_artifactCollection()}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{m.admin_artifactCollectionDesc()}</p>
      </div>
      <ToggleSwitch bind:checked={artifactsEnabled} />
    </div>
    {#if artifactsEnabled}
      <div class="mt-4 space-y-3">
        <!-- Collection Patterns -->
        <div class="text-sm text-muted-foreground">
          <span>{m.admin_collectionPatterns()}</span>
          <div class="mt-1">
            <TagInput bind:tags={artifactPatterns} placeholder={m.admin_collectionPatternsPlaceholder()} />
          </div>
        </div>

        <!-- Max Size -->
        <label class="text-sm text-muted-foreground">
          {m.admin_maxTotalSize()}
          <input
            class={inputClassName}
            type="number"
            min="1"
            max="50"
            bind:value={artifactMaxSizeMb}
          />
        </label>
      </div>
    {/if}
  </div>

  <!-- Section 4: Network Access -->
  <div class="rounded-2xl border border-border p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">{m.admin_networkAccess()}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{m.admin_networkAccessDesc()}</p>
      </div>
      <ToggleSwitch bind:checked={networkEnabled} />
    </div>
    {#if networkEnabled}
      <div class="mt-4 space-y-4">
        <!-- Firewall Rules -->
        <div class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">{m.admin_firewallRules()}</span>
          {#each firewallRules as rule, index (`fw-${String(index)}`)}
            <div class="mt-2 flex items-center gap-2">
              <input
                class="{inputClassName} mt-0 flex-1"
                placeholder={m.admin_firewallHostPlaceholder()}
                value={rule.allow}
                oninput={(e) => {
                  firewallRules = firewallRules.map((r, i) =>
                    i === index ? { ...r, allow: (e.target as HTMLInputElement).value } : r
                  );
                }}
              />
              <input
                class="{inputClassName} mt-0 w-32"
                placeholder={m.admin_firewallPortsPlaceholder()}
                value={rule.ports}
                oninput={(e) => {
                  firewallRules = firewallRules.map((r, i) =>
                    i === index ? { ...r, ports: (e.target as HTMLInputElement).value } : r
                  );
                }}
              />
              <select
                class="{inputClassName} mt-0 w-20"
                value={rule.protocol}
                onchange={(e) => {
                  firewallRules = firewallRules.map((r, i) =>
                    i === index ? { ...r, protocol: (e.target as HTMLSelectElement).value } : r
                  );
                }}
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
                <option value="any">any</option>
              </select>
              <button
                class="text-muted-foreground hover:text-red-500"
                type="button"
                onclick={() => (firewallRules = firewallRules.filter((_, i) => i !== index))}
              >
                &times;
              </button>
            </div>
          {/each}
          <button
            class="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            type="button"
            onclick={() => (firewallRules = [...firewallRules, { allow: "", ports: "", protocol: "tcp" }])}
          >
            {m.admin_addRule()}
          </button>
        </div>

        <!-- Sidecar Services -->
        <div class="text-sm text-muted-foreground">
          <span class="font-medium text-foreground">{m.admin_sidecarServices()}</span>
          {#each sidecarServices as svc, index (`sc-${String(index)}`)}
            <div class="mt-2 space-y-2 rounded-xl border border-border p-3">
              <div class="flex items-center gap-2">
                <input
                  class="{inputClassName} mt-0 flex-1"
                  placeholder={m.admin_sidecarImagePlaceholder()}
                  value={svc.image}
                  oninput={(e) => {
                    sidecarServices = sidecarServices.map((s, i) =>
                      i === index ? { ...s, image: (e.target as HTMLInputElement).value } : s
                    );
                  }}
                />
                <input
                  class="{inputClassName} mt-0 w-24"
                  type="number"
                  placeholder="Port"
                  value={svc.port}
                  oninput={(e) => {
                    sidecarServices = sidecarServices.map((s, i) =>
                      i === index ? { ...s, port: parseInt((e.target as HTMLInputElement).value, 10) || 0 } : s
                    );
                  }}
                />
                <input
                  class="{inputClassName} mt-0 w-24"
                  type="number"
                  placeholder="Memory (MB)"
                  value={svc.memoryMb}
                  oninput={(e) => {
                    sidecarServices = sidecarServices.map((s, i) =>
                      i === index ? { ...s, memoryMb: parseInt((e.target as HTMLInputElement).value, 10) || 128 } : s
                    );
                  }}
                />
                <button
                  class="text-muted-foreground hover:text-red-500"
                  type="button"
                  onclick={() => (sidecarServices = sidecarServices.filter((_, i) => i !== index))}
                >
                  &times;
                </button>
              </div>
              <input
                class="{inputClassName} mt-0"
                placeholder={m.admin_sidecarReadinessPlaceholder()}
                value={svc.readinessPath}
                oninput={(e) => {
                  sidecarServices = sidecarServices.map((s, i) =>
                    i === index ? { ...s, readinessPath: (e.target as HTMLInputElement).value } : s
                  );
                }}
              />
            </div>
          {/each}
          <button
            class="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            type="button"
            onclick={() => (sidecarServices = [...sidecarServices, { image: "", port: 5432, env: {}, readinessPath: "", memoryMb: 128 }])}
          >
            {m.admin_addService()}
          </button>
        </div>

        <!-- Log Traffic -->
        <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={logTraffic}
            onchange={() => (logTraffic = !logTraffic)}
            class="accent-primary"
          />
          {m.admin_logTraffic()}
        </label>
      </div>
    {/if}
  </div>

  <!-- Section 5: Custom Pipeline Stages -->
  <div class="rounded-2xl border border-border p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">{m.admin_customScripts()}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{m.admin_customScriptsDesc()}</p>
      </div>
      <ToggleSwitch bind:checked={customScriptsEnabled} />
    </div>
    {#if customScriptsEnabled}
      <div class="mt-4 space-y-4">
        {#each customScripts as cs, index (`cs-${String(index)}`)}
          <div class="space-y-2 rounded-xl border border-border p-3">
            <div class="flex items-center gap-2">
              <input
                class="{inputClassName} mt-0 flex-1"
                placeholder={m.admin_scriptName()}
                value={cs.name}
                oninput={(e) => {
                  customScripts = customScripts.map((s, i) =>
                    i === index ? { ...s, name: (e.target as HTMLInputElement).value } : s
                  );
                }}
              />
              <select
                class="{inputClassName} mt-0 w-36"
                value={cs.runAt}
                onchange={(e) => {
                  customScripts = customScripts.map((s, i) =>
                    i === index ? { ...s, runAt: (e.target as HTMLSelectElement).value } : s
                  );
                }}
              >
                <option value="before-compile">before-compile</option>
                <option value="after-compile">after-compile</option>
                <option value="after-check">after-check</option>
              </select>
              <select
                class="{inputClassName} mt-0 w-28"
                value={cs.language}
                onchange={(e) => {
                  customScripts = customScripts.map((s, i) =>
                    i === index ? { ...s, language: (e.target as HTMLSelectElement).value } : s
                  );
                }}
              >
                <option value="python">Python</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
                <option value="go">Go</option>
                <option value="rust">Rust</option>
              </select>
              <button
                class="text-muted-foreground hover:text-red-500"
                type="button"
                onclick={() => (customScripts = customScripts.filter((_, i) => i !== index))}
              >
                &times;
              </button>
            </div>
            <MonacoScriptEditor
              value={cs.script}
              onchange={(v) => {
                customScripts = customScripts.map((s, i) =>
                  i === index ? { ...s, script: v } : s
                );
              }}
              language={cs.language}
            />
          </div>
        {/each}
        <button
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          type="button"
          onclick={() => (customScripts = [...customScripts, { name: "", runAt: "after-check", language: "python", script: "" }])}
        >
          {m.admin_addScript()}
        </button>
      </div>
    {/if}
  </div>

  <!-- Save Button -->
  <div class="flex items-center gap-3">
    <button
      class="inline-flex w-fit rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={saving}
      type="button"
      onclick={() => void handleSave()}
    >
      {#if saving}
        {m.admin_saving()}
      {:else}
        {m.admin_saveJudgeConfig()}
      {/if}
    </button>
    {#if saveMessage === "saved"}
      <span class="text-sm text-emerald-600 dark:text-emerald-400">{m.admin_saved()}</span>
    {:else if saveMessage === "error"}
      <span class="text-sm text-red-600 dark:text-red-400">{m.admin_saveFailed()}</span>
    {/if}
  </div>
</div>
