<script lang="ts" module>
	import { cn } from "$lib/utils/css.js";

	export type SkeletonCardProps = {
		hasAction?: boolean;
		hasDescription?: boolean;
		class?: string;
	};
</script>

<script lang="ts">
	import Skeleton from "./skeleton.svelte";
	import SkeletonText from "./SkeletonText.svelte";

	let {
		hasAction = true,
		hasDescription = true,
		class: className,
	}: SkeletonCardProps = $props();
</script>

<div
	data-slot="skeleton-card"
	aria-hidden="true"
	class={cn(
		"flex flex-col gap-4 rounded-lg border border-border bg-[color:var(--color-panel)] p-4",
		className,
	)}
>
	<Skeleton variant="text" class="h-6 w-1/2" />
	{#if hasDescription}
		<SkeletonText lines={2} />
	{/if}
	{#if hasAction}
		<Skeleton class="mt-2 h-10 w-24 rounded-md" />
	{/if}
</div>
