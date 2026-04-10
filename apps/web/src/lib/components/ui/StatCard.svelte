<script lang="ts" module>
	import type { Component } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { Card } from "$lib/components/ui/card/index.js";

	export type StatCardProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		label: string;
		value: string | number;
		trend?: number;
		icon?: Component<{ class?: string }>;
	};

	function formatTrend(trend: number): { text: string; tone: "up" | "down" | "flat" } {
		if (trend > 0) return { text: `\u2191 ${String(trend)}`, tone: "up" };
		if (trend < 0) return { text: `\u2193 ${String(Math.abs(trend))}`, tone: "down" };
		return { text: `\u2013 0`, tone: "flat" };
	}
</script>

<script lang="ts">
	let {
		ref = $bindable(null),
		class: className,
		label,
		value,
		trend,
		icon: Icon,
		...restProps
	}: StatCardProps = $props();

	const trendInfo = $derived(trend !== undefined ? formatTrend(trend) : null);
</script>

<Card bind:ref variant="surface" size="md" data-slot="stat-card" class={cn(className)} {...restProps}>
	<div class="flex items-start justify-between gap-3">
		<span
			class="text-caption font-medium tracking-wide uppercase text-muted-foreground"
		>
			{label}
		</span>
		{#if Icon}
			<Icon class="h-5 w-5 shrink-0 text-muted-foreground" />
		{/if}
	</div>
	<div class="flex items-end justify-between gap-3">
		<span
			class="font-display text-headline leading-tight font-semibold tabular-nums"
		>
			{value}
		</span>
		{#if trendInfo}
			<span
				class={cn(
					"inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums",
					trendInfo.tone === "up" && "bg-[color:color-mix(in_oklch,var(--success)_18%,transparent)] text-[color:var(--success)]",
					trendInfo.tone === "down" && "bg-[color:color-mix(in_oklch,var(--destructive)_18%,transparent)] text-[color:var(--destructive)]",
					trendInfo.tone === "flat" && "bg-muted text-muted-foreground"
				)}
			>
				{trendInfo.text}
			</span>
		{/if}
	</div>
</Card>
