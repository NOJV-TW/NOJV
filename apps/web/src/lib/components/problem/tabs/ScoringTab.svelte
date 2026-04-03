<script lang="ts">
  import type { ProblemDetail } from "$lib/types";
  import { inputClassName } from "$lib/utils";
  import MonacoScriptEditor from "$lib/components/problem/editors/MonacoScriptEditor.svelte";
  import ToggleSwitch from "$lib/components/ui/ToggleSwitch.svelte";
  import type { SubtaskScoringStrategy, ScoringRule } from "@nojv/core";

  interface Props {
    problem: ProblemDetail;
  }

  let { problem }: Props = $props();

  // ─── State derived from problem.judgeConfig.scoring ─────────────────
  const cfg = problem.judgeConfig?.scoring ?? {};

  // Testcase sets from problem data (subtasks = weight > 0)
  // These come from the testcaseSets loaded in the page
  const testcaseSets: { id: string; name: string; weight: number }[] = [];

  // Section 1: Subtask Scoring Strategies
  let subtaskStrategies = $state<Record<string, SubtaskScoringStrategy>>(
    cfg.subtaskStrategies ?? {}
  );

  // Section 2: Score Adjustments
  let adjustmentsEnabled = $state((cfg.adjustmentRules ?? []).length > 0);
  let adjustmentRules = $state<ScoringRule[]>(cfg.adjustmentRules ?? []);

  // Section 3: Custom Scoring Script
  let scriptEnabled = $state(!!cfg.script);
  let scoringScript = $state(cfg.script ?? "");
  let scoringLanguage = $state(cfg.language ?? "python");
  let scoringTimeout = $state(cfg.timeoutMs ?? 30_000);

  // ─── Rule management ───────────────────────────────────────────────
  type RuleType = ScoringRule["type"];

  function addRule() {
    adjustmentRules = [
      ...adjustmentRules,
      { type: "late_penalty_fixed", perUnit: "day", amount: 10, maxDeduction: 50 },
    ];
  }

  function removeRule(index: number) {
    adjustmentRules = adjustmentRules.filter((_, i) => i !== index);
  }

  function updateRuleType(index: number, newType: RuleType) {
    const defaults: Record<RuleType, ScoringRule> = {
      late_penalty_fixed: { type: "late_penalty_fixed", perUnit: "day", amount: 10, maxDeduction: 50 },
      late_penalty_decay: { type: "late_penalty_decay", halfLifeHours: 48 },
      time_bonus: { type: "time_bonus", maxBonusPercent: 10, baselineMs: 1000 },
      memory_penalty: { type: "memory_penalty", thresholdMb: 128, maxDeduction: 20 },
    };
    adjustmentRules = adjustmentRules.map((r, i) => (i === index ? defaults[newType] : r));
  }

  // ─── Default template ──────────────────────────────────────────────
  const defaultScoringTemplate = `import sys
import json

# Input: JSON on stdin with fields:
#   testcaseResults: [{ verdict, timeMs, memoryKb, score }]
#   subtaskResults: [{ name, score, maxScore }]
#   submissionMeta: { language, submittedAt }
#
# Output: JSON on stdout with fields:
#   score: number (0-100)
#   feedback: string (optional)

data = json.loads(sys.stdin.read())
subtasks = data.get("subtaskResults", [])

total = sum(s["score"] for s in subtasks)
max_total = sum(s["maxScore"] for s in subtasks)
score = round(total / max_total * 100) if max_total > 0 else 0

print(json.dumps({"score": score}))
`;

  // ─── Formula preview ───────────────────────────────────────────────
  let formulaPreview = $derived.by(() => {
    if (testcaseSets.length === 0) return "";
    const parts = testcaseSets
      .filter((s) => s.weight > 0)
      .map((s) => {
        const strategy = subtaskStrategies[s.id] ?? "all_or_nothing";
        const label =
          strategy === "all_or_nothing" ? "全過" :
          strategy === "proportional" ? "比例" : "最低";
        return `${s.name}(${String(s.weight)}pts, ${label})`;
      });
    return parts.join(" + ");
  });

  // ─── Save ──────────────────────────────────────────────────────────
  let saving = $state(false);
  let saveMessage = $state("");

  function buildScoringConfig() {
    const config: Record<string, unknown> = {};

    if (Object.keys(subtaskStrategies).length > 0) {
      config.subtaskStrategies = subtaskStrategies;
    }

    if (adjustmentsEnabled && adjustmentRules.length > 0) {
      config.adjustmentRules = adjustmentRules;
    }

    if (scriptEnabled && scoringScript) {
      config.script = scoringScript;
      config.language = scoringLanguage;
      config.timeoutMs = scoringTimeout;
    }

    return config;
  }

  async function handleSave() {
    saving = true;
    saveMessage = "";
    try {
      const data = buildScoringConfig();
      const formData = new FormData();
      formData.set("data", JSON.stringify(data));
      const response = await fetch("?/updateScoring", {
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
  <!-- Section 1: Subtask Scoring -->
  <div class="rounded-2xl border border-border p-4">
    <h3 class="text-sm font-medium">子任務評分策略</h3>
    <p class="mt-0.5 text-xs text-muted-foreground">設定每個子任務的評分方式</p>

    {#if testcaseSets.filter((s) => s.weight > 0).length === 0}
      <p class="mt-3 text-sm text-muted-foreground">
        請先在「測資管理」分頁新增測資集
      </p>
    {:else}
      <div class="mt-3 space-y-2">
        {#each testcaseSets.filter((s) => s.weight > 0) as set (set.id)}
          <div class="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
            <span class="text-sm font-medium">{set.name}</span>
            <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {set.weight} pts
            </span>
            <select
              class="{inputClassName} mt-0 ml-auto w-40"
              value={subtaskStrategies[set.id] ?? "all_or_nothing"}
              onchange={(e) => {
                subtaskStrategies = {
                  ...subtaskStrategies,
                  [set.id]: (e.target as HTMLSelectElement).value as SubtaskScoringStrategy,
                };
              }}
            >
              <option value="all_or_nothing">全過才給分</option>
              <option value="proportional">按通過比例</option>
              <option value="minimum">取最低分</option>
            </select>
          </div>
        {/each}
      </div>

      {#if formulaPreview}
        <div class="mt-3 rounded-xl bg-muted/50 px-3 py-2">
          <span class="text-xs text-muted-foreground">總分計算: </span>
          <span class="text-xs font-mono">{formulaPreview}</span>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Section 2: Score Adjustments -->
  <div class="rounded-2xl border border-border p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">分數調整規則</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">依據繳交時間或資源用量調整最終分數</p>
      </div>
      <ToggleSwitch bind:checked={adjustmentsEnabled} />
    </div>
    {#if adjustmentsEnabled}
      <div class="mt-4 space-y-3">
        {#each adjustmentRules as rule, index (`rule-${String(index)}`)}
          <div class="space-y-2 rounded-xl border border-border p-3">
            <div class="flex items-center gap-2">
              <select
                class="{inputClassName} mt-0 flex-1"
                value={rule.type}
                onchange={(e) => updateRuleType(index, (e.target as HTMLSelectElement).value as RuleType)}
              >
                <option value="late_penalty_fixed">遲交扣分 (固定)</option>
                <option value="late_penalty_decay">遲交扣分 (衰減)</option>
                <option value="time_bonus">時間獎勵</option>
                <option value="memory_penalty">記憶體超額扣分</option>
              </select>
              <button
                class="text-muted-foreground hover:text-red-500"
                type="button"
                onclick={() => removeRule(index)}
              >
                &times;
              </button>
            </div>

            {#if rule.type === "late_penalty_fixed"}
              <div class="flex flex-wrap items-center gap-3 text-sm">
                <label class="text-muted-foreground">
                  每
                  <select
                    class="{inputClassName} mt-0 inline-block w-auto"
                    value={rule.perUnit}
                    onchange={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, perUnit: (e.target as HTMLSelectElement).value as "day" | "week" } : r
                      );
                    }}
                  >
                    <option value="day">天</option>
                    <option value="week">週</option>
                  </select>
                </label>
                <label class="text-muted-foreground">
                  扣
                  <input
                    class="{inputClassName} mt-0 inline-block w-20"
                    type="number"
                    min="0"
                    max="100"
                    value={rule.amount}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, amount: Number((e.target as HTMLInputElement).value) || 0 } : r
                      );
                    }}
                  />
                  分
                </label>
                <label class="text-muted-foreground">
                  最多扣
                  <input
                    class="{inputClassName} mt-0 inline-block w-20"
                    type="number"
                    min="0"
                    max="100"
                    value={rule.maxDeduction}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, maxDeduction: Number((e.target as HTMLInputElement).value) || 0 } : r
                      );
                    }}
                  />
                  分
                </label>
              </div>
            {:else if rule.type === "late_penalty_decay"}
              <div class="flex items-center gap-3 text-sm">
                <label class="text-muted-foreground">
                  半衰期
                  <input
                    class="{inputClassName} mt-0 inline-block w-24"
                    type="number"
                    min="1"
                    max="8760"
                    value={rule.halfLifeHours}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, halfLifeHours: Number((e.target as HTMLInputElement).value) || 48 } : r
                      );
                    }}
                  />
                  小時
                </label>
              </div>
            {:else if rule.type === "time_bonus"}
              <div class="flex flex-wrap items-center gap-3 text-sm">
                <label class="text-muted-foreground">
                  最高加分
                  <input
                    class="{inputClassName} mt-0 inline-block w-20"
                    type="number"
                    min="0"
                    max="100"
                    value={rule.maxBonusPercent}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, maxBonusPercent: Number((e.target as HTMLInputElement).value) || 0 } : r
                      );
                    }}
                  />
                  %
                </label>
                <label class="text-muted-foreground">
                  基準時間
                  <input
                    class="{inputClassName} mt-0 inline-block w-24"
                    type="number"
                    min="0"
                    value={rule.baselineMs}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, baselineMs: Number((e.target as HTMLInputElement).value) || 0 } : r
                      );
                    }}
                  />
                  ms
                </label>
              </div>
            {:else if rule.type === "memory_penalty"}
              <div class="flex flex-wrap items-center gap-3 text-sm">
                <label class="text-muted-foreground">
                  門檻
                  <input
                    class="{inputClassName} mt-0 inline-block w-24"
                    type="number"
                    min="0"
                    value={rule.thresholdMb}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, thresholdMb: Number((e.target as HTMLInputElement).value) || 0 } : r
                      );
                    }}
                  />
                  MB
                </label>
                <label class="text-muted-foreground">
                  最多扣
                  <input
                    class="{inputClassName} mt-0 inline-block w-20"
                    type="number"
                    min="0"
                    max="100"
                    value={rule.maxDeduction}
                    oninput={(e) => {
                      adjustmentRules = adjustmentRules.map((r, i) =>
                        i === index ? { ...r, maxDeduction: Number((e.target as HTMLInputElement).value) || 0 } : r
                      );
                    }}
                  />
                  分
                </label>
              </div>
            {/if}
          </div>
        {/each}
        <button
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          type="button"
          onclick={addRule}
        >
          + 新增規則
        </button>
      </div>
    {/if}
  </div>

  <!-- Section 3: Custom Scoring Script -->
  <div class="rounded-2xl border border-border p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-medium">自訂評分腳本</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">使用腳本自訂評分邏輯</p>
      </div>
      <ToggleSwitch bind:checked={scriptEnabled} />
    </div>
    {#if scriptEnabled}
      <div class="mt-4 space-y-3">
        <div class="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          &#9888; 啟用後將覆蓋上方規則
        </div>

        <div class="flex items-center gap-3">
          <label class="text-sm text-muted-foreground">
            語言
            <select
              class="{inputClassName} mt-0 inline-block w-auto"
              bind:value={scoringLanguage}
            >
              <option value="python">Python</option>
              <option value="cpp">C++</option>
            </select>
          </label>
          <label class="text-sm text-muted-foreground">
            超時
            <input
              class="{inputClassName} mt-0 inline-block w-24"
              type="number"
              min="1000"
              max="60000"
              step="1000"
              bind:value={scoringTimeout}
            />
            ms
          </label>
          <button
            class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            type="button"
            onclick={() => { scoringScript = defaultScoringTemplate; scoringLanguage = "python"; }}
          >
            載入預設模板
          </button>
        </div>

        <MonacoScriptEditor
          value={scoringScript}
          onchange={(v) => (scoringScript = v)}
          language={scoringLanguage}
        />
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
        儲存中...
      {:else}
        儲存評分設定
      {/if}
    </button>
    {#if saveMessage === "saved"}
      <span class="text-sm text-emerald-600 dark:text-emerald-400">已儲存</span>
    {:else if saveMessage === "error"}
      <span class="text-sm text-red-600 dark:text-red-400">儲存失敗</span>
    {/if}
  </div>
</div>
