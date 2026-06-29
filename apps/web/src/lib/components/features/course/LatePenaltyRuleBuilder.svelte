<script lang="ts" module>
  import type { AdjustmentRule } from "@nojv/core";

  export type LatePenaltyOptionKey =
    "none" | "flat_late_penalty" | "daily_late_penalty" | "final_day_zero";

  export type LatePenaltyRule = Extract<
    AdjustmentRule,
    { type: "flat_late_penalty" | "daily_late_penalty" | "final_day_zero" }
  > | null;
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    value: LatePenaltyRule;
    onChange: (value: LatePenaltyRule) => void;
    class?: string;
    name?: string;
  }

  let { value, onChange, class: className, name = "late-penalty-rule" }: Props = $props();

  const selectedKey = $derived<LatePenaltyOptionKey>(value === null ? "none" : value.type);

  const FLAT_DEFAULT_PCT = 20;
  const DAILY_DEFAULT_PCT = 10;

  function handleSelect(key: LatePenaltyOptionKey) {
    if (key === "none") {
      onChange(null);
      return;
    }
    if (key === "flat_late_penalty") {
      onChange({
        type: "flat_late_penalty",
        penaltyPct: value?.type === "flat_late_penalty" ? value.penaltyPct : FLAT_DEFAULT_PCT,
        startFrom: value?.type === "flat_late_penalty" ? value.startFrom : "due",
      });
      return;
    }
    if (key === "daily_late_penalty") {
      onChange({
        type: "daily_late_penalty",
        perDayPct: value?.type === "daily_late_penalty" ? value.perDayPct : DAILY_DEFAULT_PCT,
        startFrom: value?.type === "daily_late_penalty" ? value.startFrom : "due",
      });
      return;
    }
    onChange({ type: "final_day_zero" });
  }

  function updateFlatPct(raw: string) {
    if (value?.type !== "flat_late_penalty") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({ ...value, penaltyPct: Math.max(0, Math.min(100, parsed)) });
  }

  function updateFlatStartFrom(raw: string) {
    if (value?.type !== "flat_late_penalty") return;
    if (raw !== "due" && raw !== "final_day") return;
    onChange({ ...value, startFrom: raw });
  }

  function updateDailyPct(raw: string) {
    if (value?.type !== "daily_late_penalty") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({ ...value, perDayPct: Math.max(0, Math.min(100, parsed)) });
  }

  function updateDailyStartFrom(raw: string) {
    if (value?.type !== "daily_late_penalty") return;
    if (raw !== "due" && raw !== "final_day") return;
    onChange({ ...value, startFrom: raw });
  }

  const options = $derived([
    {
      key: "none" as const,
      title: m.latePenalty_noneTitle(),
      desc: m.latePenalty_noneDesc(),
    },
    {
      key: "flat_late_penalty" as const,
      title: m.latePenalty_flatTitle(),
      desc: m.latePenalty_flatDesc(),
    },
    {
      key: "daily_late_penalty" as const,
      title: m.latePenalty_dailyTitle(),
      desc: m.latePenalty_dailyDesc(),
    },
    {
      key: "final_day_zero" as const,
      title: m.latePenalty_finalDayZeroTitle(),
      desc: m.latePenalty_finalDayZeroDesc(),
    },
  ]);

  const paramInputClass =
    "w-[84px] rounded-sm border border-border bg-background px-2 py-1 text-right font-mono text-body-sm font-semibold tabular-nums focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const paramSelectClass =
    "rounded-sm border border-border bg-background px-2 py-1 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
</script>

<div data-slot="late-penalty-rule-builder" class={cn("flex flex-col gap-3", className)}>
  {#each options as option (option.key)}
    {@const isSelected = option.key === selectedKey}
    <label
      class={cn(
        "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-3.5 rounded-md border bg-[color:var(--color-panel)] px-4 py-4 transition-[border-color,background-color,box-shadow] duration-fast ease-out-soft hover:border-border-strong",
        isSelected &&
          "border-primary bg-[color-mix(in_oklab,var(--color-primary)_4%,transparent)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_8%,transparent)]",
      )}
    >
      <input
        type="radio"
        {name}
        value={option.key}
        checked={isSelected}
        onchange={() => handleSelect(option.key)}
        class="mt-0.5 accent-primary"
      />
      <div class="min-w-0">
        <div class="text-body font-semibold tracking-[-0.005em]">
          {option.title}
        </div>
        <div class="mt-1 text-caption leading-relaxed text-muted-foreground">
          {option.desc}
        </div>
        {#if isSelected && option.key === "flat_late_penalty" && value?.type === "flat_late_penalty"}
          <div
            class="mt-3 flex flex-wrap items-center gap-3 rounded-sm bg-[color:var(--color-panel-strong)] px-3.5 py-3"
          >
            <span class="text-caption text-muted-foreground">
              {m.latePenalty_flatDeductLabel()}
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={value.penaltyPct}
              oninput={(e) => updateFlatPct(e.currentTarget.value)}
              class={paramInputClass}
              aria-label={m.latePenalty_flatDeductLabel()}
            />
            <span class="text-caption">%</span>
            <span class="inline-block h-5 w-px bg-border" aria-hidden="true"></span>
            <span class="text-caption text-muted-foreground">
              {m.latePenalty_startFromLabel()}
            </span>
            <select
              value={value.startFrom}
              onchange={(e) => updateFlatStartFrom(e.currentTarget.value)}
              class={paramSelectClass}
              aria-label={m.latePenalty_startFromLabel()}
            >
              <option value="due">{m.latePenalty_startFromDue()}</option>
              <option value="final_day">{m.latePenalty_startFromFinalDay()}</option>
            </select>
          </div>
        {:else if isSelected && option.key === "daily_late_penalty" && value?.type === "daily_late_penalty"}
          <div
            class="mt-3 flex flex-wrap items-center gap-3 rounded-sm bg-[color:var(--color-panel-strong)] px-3.5 py-3"
          >
            <span class="text-caption text-muted-foreground">
              {m.latePenalty_dailyPerDayLabel()}
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={value.perDayPct}
              oninput={(e) => updateDailyPct(e.currentTarget.value)}
              class={paramInputClass}
              aria-label={m.latePenalty_dailyPerDayLabel()}
            />
            <span class="text-caption">%</span>
            <span class="inline-block h-5 w-px bg-border" aria-hidden="true"></span>
            <span class="text-caption text-muted-foreground">
              {m.latePenalty_startFromLabel()}
            </span>
            <select
              value={value.startFrom}
              onchange={(e) => updateDailyStartFrom(e.currentTarget.value)}
              class={paramSelectClass}
              aria-label={m.latePenalty_startFromLabel()}
            >
              <option value="due">{m.latePenalty_startFromDue()}</option>
              <option value="final_day">{m.latePenalty_startFromFinalDay()}</option>
            </select>
          </div>
        {/if}
      </div>
    </label>
  {/each}
</div>
