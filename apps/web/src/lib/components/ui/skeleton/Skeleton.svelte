<script lang="ts" module>
	import { cn } from "$lib/utils/css.js";
	import type { HTMLAttributes } from "svelte/elements";

	export type SkeletonVariant = "text" | "circle" | "block";

	export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
		variant?: SkeletonVariant;
		animate?: boolean;
		class?: string;
	};
</script>

<script lang="ts">
	/**
	 * Base skeleton primitive. Decorative only — the parent loading region is
	 * responsible for setting `aria-busy="true"` on its wrapper.
	 *
	 * @example
	 *   <div aria-busy="true">
	 *     <Skeleton class="h-4 w-full" variant="text" />
	 *   </div>
	 */
	let {
		variant = "block",
		animate = true,
		class: className,
		children,
		...restProps
	}: SkeletonProps = $props();

	const variantClass = $derived(
		variant === "text"
			? "rounded-sm"
			: variant === "circle"
				? "rounded-full aspect-square"
				: "rounded-md",
	);
</script>

<div
	data-slot="skeleton"
	aria-hidden="true"
	class={cn("relative overflow-hidden bg-muted", variantClass, className)}
	{...restProps}
>
	{#if animate}
		<div
			class="motion-safe:animate-[shimmer_1.8s_ease-in-out_infinite] pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[color:var(--color-muted-foreground)]/10 to-transparent bg-[length:200%_100%] motion-reduce:hidden"
		></div>
	{/if}
	{@render children?.()}
</div>
