<script lang="ts">
  import type { AdjustmentRule } from "@nojv/core";
  import { inputClassName } from "$lib/utils";

  interface Props {
    rules: AdjustmentRule[];
  }

  let { rules = $bindable([]) }: Props = $props();

  type RuleType = AdjustmentRule["type"];

  const defaultsByType: Record<RuleType, AdjustmentRule> = {
    late_penalty_fixed: { type: "late_penalty_fixed", perUnit: "day", amount: 10, maxDeduction: 50 },
    late_penalty_decay: { type: "late_penalty_decay", halfLifeHours: 48 },
    time_bonus: { type: "time_bonus", maxBonusPercent: 10, baselineMs: 1000 },
    memory_penalty: { type: "memory_penalty", thresholdMb: 128, maxDeduction: 20 }
  };

  function addRule() {
    rules = [...rules, defaultsByType.late_penalty_fixed];
  }

  function removeRule(index: number) {
    rules = rules.filter((_, i) => i !== index);
  }

  function changeRuleType(index: number, newType: RuleType) {
    rules = rules.map((r, i) => (i === index ? defaultsByType[newType] : r));
  }

  function updateRule(index: number, updated: Partial<AdjustmentRule>) {
    rules = rules.map((r, i) => (i === index ? ({ ...r, ...updated } as AdjustmentRule) : r));
  }
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-sm font-semibold">Score adjustments</h3>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Rules applied to the raw score of every submission under this
        assessment / contest. Rules apply in order; final score is
        clamped to [0, 100].
      </p>
    </div>
    <button
      type="button"
      class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      onclick={addRule}
    >
      + Add rule
    </button>
  </div>

  {#if rules.length === 0}
    <p class="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
      No adjustments configured. Raw submission scores are used as-is.
    </p>
  {:else}
    <div class="space-y-2">
      {#each rules as rule, index (`rule-${index}`)}
        <div class="space-y-2 rounded-xl border border-border p-3">
          <div class="flex items-center gap-2">
            <select
              class="{inputClassName} mt-0 flex-1"
              value={rule.type}
              onchange={(e) =>
                changeRuleType(index, (e.target as HTMLSelectElement).value as RuleType)}
            >
              <option value="late_penalty_fixed">Late penalty (fixed)</option>
              <option value="late_penalty_decay">Late penalty (decay)</option>
              <option value="time_bonus">Time bonus</option>
              <option value="memory_penalty">Memory penalty</option>
            </select>
            <button
              type="button"
              class="text-muted-foreground hover:text-red-500"
              onclick={() => removeRule(index)}
              aria-label="Remove rule"
            >
              &times;
            </button>
          </div>

          {#if rule.type === "late_penalty_fixed"}
            <div class="flex flex-wrap items-center gap-3 text-xs">
              <label class="text-muted-foreground">
                Per
                <select
                  class="{inputClassName} mt-0 inline-block w-auto"
                  value={rule.perUnit}
                  onchange={(e) =>
                    updateRule(index, {
                      perUnit: (e.target as HTMLSelectElement).value as "day" | "week"
                    })}
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                </select>
              </label>
              <label class="text-muted-foreground">
                Deduct
                <input
                  class="{inputClassName} mt-0 inline-block w-20"
                  type="number"
                  min="0"
                  max="100"
                  value={rule.amount}
                  oninput={(e) =>
                    updateRule(index, {
                      amount: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                pts
              </label>
              <label class="text-muted-foreground">
                Max
                <input
                  class="{inputClassName} mt-0 inline-block w-20"
                  type="number"
                  min="0"
                  max="100"
                  value={rule.maxDeduction}
                  oninput={(e) =>
                    updateRule(index, {
                      maxDeduction: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                pts
              </label>
            </div>
          {:else if rule.type === "late_penalty_decay"}
            <label class="text-xs text-muted-foreground">
              Half-life (hours)
              <input
                class="{inputClassName} mt-0 inline-block w-24"
                type="number"
                min="1"
                max="8760"
                value={rule.halfLifeHours}
                oninput={(e) =>
                  updateRule(index, {
                    halfLifeHours: Number((e.target as HTMLInputElement).value) || 48
                  })}
              />
            </label>
          {:else if rule.type === "time_bonus"}
            <div class="flex flex-wrap items-center gap-3 text-xs">
              <label class="text-muted-foreground">
                Max bonus
                <input
                  class="{inputClassName} mt-0 inline-block w-20"
                  type="number"
                  min="0"
                  max="100"
                  value={rule.maxBonusPercent}
                  oninput={(e) =>
                    updateRule(index, {
                      maxBonusPercent: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                %
              </label>
              <label class="text-muted-foreground">
                Baseline runtime
                <input
                  class="{inputClassName} mt-0 inline-block w-24"
                  type="number"
                  min="0"
                  value={rule.baselineMs}
                  oninput={(e) =>
                    updateRule(index, {
                      baselineMs: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                ms
              </label>
            </div>
          {:else}
            <div class="flex flex-wrap items-center gap-3 text-xs">
              <label class="text-muted-foreground">
                Memory threshold
                <input
                  class="{inputClassName} mt-0 inline-block w-24"
                  type="number"
                  min="0"
                  value={rule.thresholdMb}
                  oninput={(e) =>
                    updateRule(index, {
                      thresholdMb: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                MB
              </label>
              <label class="text-muted-foreground">
                Max deduct
                <input
                  class="{inputClassName} mt-0 inline-block w-20"
                  type="number"
                  min="0"
                  max="100"
                  value={rule.maxDeduction}
                  oninput={(e) =>
                    updateRule(index, {
                      maxDeduction: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                pts
              </label>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
