<script lang="ts">
  interface Props {
    value: number;
    size?: number;
    stroke?: number;
    label?: string;
  }

  let { value, size = 56, stroke = 6, label }: Props = $props();

  const r = $derived((size - stroke) / 2);
  const C = $derived(2 * Math.PI * r);
  const off = $derived(C - (Math.max(0, Math.min(100, value)) / 100) * C);
  const text = $derived(label ?? `${String(Math.round(value))}%`);
</script>

<div
  class="relative inline-grid place-items-center"
  style="width: {size}px; height: {size}px;"
>
  <svg width={size} height={size} class="-rotate-90">
    <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--muted)" stroke-width={stroke} />
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="var(--primary)"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray="{C} {C}"
      stroke-dashoffset={off}
      style="transition: stroke-dashoffset 480ms var(--ease-out-soft);"
    />
  </svg>
  <span class="absolute font-mono text-caption font-semibold">{text}</span>
</div>
