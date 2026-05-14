<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils/css.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLParagraphElement>> = $props();
</script>

<p
	bind:this={ref}
	data-slot="card-description"
	class={cn(
		"text-muted-foreground text-[length:var(--text-body-sm)] [text-wrap:pretty]",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</p>
