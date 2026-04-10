<script lang="ts" module>
	import { cn } from "$lib/utils.js";
	import { Card, type CardProps } from "$lib/components/ui/card/index.js";

	export type PanelProps = CardProps;
</script>

<script lang="ts">
	let {
		ref = $bindable(null),
		class: className,
		variant = "strong",
		size = "sm",
		interactive,
		children,
		...restProps
	}: PanelProps = $props();
</script>

<Card
	bind:ref
	{variant}
	{size}
	{interactive}
	data-slot="panel"
	class={cn(className)}
	{...restProps}
>
	{@render children?.()}
</Card>
