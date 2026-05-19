<script lang="ts" module>
	import { cn } from "$lib/utils/css.js";

	export type SkeletonStatProps = {
		class?: string;
	};
</script>

<script lang="ts">
	import Skeleton from "./skeleton.svelte";

	let { class: className }: SkeletonStatProps = $props();
</script>

<div
	data-slot="skeleton-stat"
	aria-hidden="true"
	class={cn(
		"flex flex-col gap-3 rounded-lg border border-border bg-[color:var(--color-panel)] p-4",
		className,
	)}
>
	<Skeleton variant="text" class="h-3 w-20" />
	<Skeleton class="h-10 w-28" />
</div>
