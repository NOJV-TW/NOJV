<script lang="ts" module>
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import { cn, type WithElementRef } from "$lib/utils/css.js";

	export type SectionProps = WithElementRef<HTMLAttributes<HTMLElement>> & {
		header?: Snippet;
		actions?: Snippet;
		divider?: boolean;
	};
</script>

<script lang="ts">
	let {
		ref = $bindable(null),
		class: className,
		header,
		actions,
		divider = false,
		children,
		...restProps
	}: SectionProps = $props();
</script>

<section
	bind:this={ref}
	data-slot="section"
	class={cn("flex flex-col", className)}
	{...restProps}
>
	{#if header || actions}
		<div
			class={cn(
				"section-header mb-6 flex items-start justify-between gap-4",
				divider && "border-b border-border-subtle pb-4"
			)}
		>
			<div class="min-w-0 flex flex-col gap-1.5">
				{@render header?.()}
			</div>
			{#if actions}
				<div class="flex shrink-0 items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}
	{@render children?.()}
</section>

<style>
	.section-header :global(h1),
	.section-header :global(h2),
	.section-header :global(h3) {
		font-size: var(--text-title-lg);
		font-weight: 600;
		line-height: var(--leading-tight);
		text-wrap: balance;
	}
	.section-header :global(p) {
		color: var(--muted-foreground);
		font-size: var(--text-body-sm);
		line-height: var(--leading-normal);
		text-wrap: pretty;
		margin: 0;
	}
</style>
