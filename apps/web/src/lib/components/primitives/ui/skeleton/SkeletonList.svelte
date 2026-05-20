<script lang="ts" module>
	import { cn } from "$lib/utils/css.js";

	export type SkeletonListProps = {
		rows?: number;
		class?: string;
	};
</script>

<script lang="ts">
	import Skeleton from "./skeleton.svelte";

	let { rows = 5, class: className }: SkeletonListProps = $props();

	const count = $derived(Math.max(1, rows));
</script>

<div
	data-slot="skeleton-list"
	aria-hidden="true"
	class={cn("flex flex-col", className)}
>
	{#each Array(count) as _, i (i)}
		<div class="flex items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
			<Skeleton variant="circle" class="h-10 w-10" />
			<div class="flex flex-1 flex-col gap-2">
				<Skeleton variant="text" class="h-4 w-2/5" />
				<Skeleton variant="text" class="h-3 w-3/5" />
			</div>
			<Skeleton class="h-5 w-16 rounded-full" />
		</div>
	{/each}
</div>
