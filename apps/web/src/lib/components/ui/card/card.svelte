<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		"bg-[color:var(--color-panel)] text-card-foreground flex flex-col gap-6 rounded-[2rem] border border-border py-6 shadow-sm backdrop-blur-sm",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
