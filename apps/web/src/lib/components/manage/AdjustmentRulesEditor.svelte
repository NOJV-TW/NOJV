<script lang="ts">
  import type { AdjustmentRule } from "@nojv/core";
  import { inputClassName } from "$lib/utils";

  interface Props {
    rules: AdjustmentRule[];
  }

  let { rules = $bindable([]) }: Props = $props();

  type RuleType = AdjustmentRule["type"];

  const defaultsByType: Record<RuleType, AdjustmentRule> = {
    time_bonus: { type: "time_bonus", maxBonusPercent: 10, baselineMs: 1000 },
    flat_late_penalty: { type: "flat_late_penalty", penaltyPct: 20, startFrom: "due" },
    daily_late_penalty: { type: "daily_late_penalty", perDayPct: 10, startFrom: "due" },
    final_day_zero: { type: "final_day_zero" }
  };

  function addRule() {
    rules = [...rules, defaultsByType.flat_late_penalty];
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
      <h3 class="text-body-sm font-semibold">Score adjustments</h3>
      <p class="mt-0.5 text-caption text-muted-foreground">
        Rules applied to the raw score of every submission under this
        assessment / contest. Rules apply in order; final score is
        clamped to [0, 100].
      </p>
    </div>
    <button
      type="button"
      class="rounded-md border border-border-subtle px-3 py-1.5 text-caption font-medium transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-accent-foreground"
      onclick={addRule}
    >
      + Add rule
    </button>
  </div>

  {#if rules.length === 0}
    <p class="rounded-lg border border-dashed border-border-subtle p-3 text-center text-caption text-muted-foreground">
      No adjustments configured. Raw submission scores are used as-is.
    </p>
  {:else}
    <div class="space-y-2">
      {#each rules as rule, index (`rule-${index}`)}
        <div class="space-y-2 rounded-lg border border-border-subtle p-3">
          <div class="flex items-center gap-2">
            <select
              class="{inputClassName} mt-0 flex-1"
              value={rule.type}
              onchange={(e) =>
                changeRuleType(index, (e.target as HTMLSelectElement).value as RuleType)}
            >
              <option value="flat_late_penalty">Flat late penalty</option>
              <option value="daily_late_penalty">Daily late penalty</option>
              <option value="final_day_zero">Final day zero</option>
              <option value="time_bonus">Time bonus</option>
            </select>
            <button
              type="button"
              class="text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-destructive"
              onclick={() => removeRule(index)}
              aria-label="Remove rule"
            >
              &times;
            </button>
          </div>

          {#if rule.type === "flat_late_penalty"}
            <div class="flex flex-wrap items-center gap-3 text-caption">
              <label class="text-muted-foreground">
                Deduct
                <input
                  class="{inputClassName} mt-0 inline-block w-20"
                  type="number"
                  min="0"
                  max="100"
                  value={rule.penaltyPct}
                  oninput={(e) =>
                    updateRule(index, {
                      penaltyPct: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                %
              </label>
              <label class="text-muted-foreground">
                Starting from
                <select
                  class="{inputClassName} mt-0 inline-block w-auto"
                  value={rule.startFrom}
                  onchange={(e) =>
                    updateRule(index, {
                      startFrom: (e.target as HTMLSelectElement).value as "due" | "final_day"
                    })}
                >
                  <option value="due">Due date</option>
                  <option value="final_day">Final day</option>
                </select>
              </label>
            </div>
          {:else if rule.type === "daily_late_penalty"}
            <div class="flex flex-wrap items-center gap-3 text-caption">
              <label class="text-muted-foreground">
                Per day
                <input
                  class="{inputClassName} mt-0 inline-block w-20"
                  type="number"
                  min="0"
                  max="100"
                  value={rule.perDayPct}
                  oninput={(e) =>
                    updateRule(index, {
                      perDayPct: Number((e.target as HTMLInputElement).value) || 0
                    })}
                />
                %
              </label>
              <label class="text-muted-foreground">
                Starting from
                <select
                  class="{inputClassName} mt-0 inline-block w-auto"
                  value={rule.startFrom}
                  onchange={(e) =>
                    updateRule(index, {
                      startFrom: (e.target as HTMLSelectElement).value as "due" | "final_day"
                    })}
                >
                  <option value="due">Due date</option>
                  <option value="final_day">Final day</option>
                </select>
              </label>
            </div>
          {:else if rule.type === "final_day_zero"}
            <p class="text-caption text-muted-foreground">
              Any submission strictly after the assessment's final day
              (closesAt) is worth 0.
            </p>
          {:else}
            <div class="flex flex-wrap items-center gap-3 text-caption">
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
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
