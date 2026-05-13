<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils/css.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-footer"
	class={cn("flex items-center gap-2 [.border-t]:pt-4", className)}
	{...restProps}
>
	{@render children?.()}
</div>
