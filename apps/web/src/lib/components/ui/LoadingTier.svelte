<script lang="ts" module>
	import type { Snippet } from "svelte";

	export type LoadingTierProps = {
		loading: boolean;
		skeleton?: Snippet;
		slow?: Snippet;
		children?: Snippet;
	};
</script>

<script lang="ts">
	/**
	 * Time-based loading orchestrator implementing UX principle #20
	 * (Doherty threshold feedback tiers):
	 *
	 *   - `< 400ms`          → render nothing (instant-feel, avoid flash of UI)
	 *   - `400ms – 2000ms`   → render the `skeleton` snippet
	 *   - `> 2000ms`         → render `skeleton` + `slow` snippet together
	 *
	 * When `loading` flips back to false, the real content (`children`) is
	 * rendered and the internal tier resets to `"instant"` for the next cycle.
	 *
	 * The caller supplies the `slow` message snippet — `LoadingTier` does not
	 * ship with a default message (keeps translation ownership with callers).
	 *
	 * @example
	 *   <LoadingTier loading={isLoading}>
	 *     {#snippet skeleton()}
	 *       <SkeletonCard />
	 *     {/snippet}
	 *     {#snippet slow()}
	 *       <p class="text-sm text-muted-foreground">{m.loading_slow_default()}</p>
	 *     {/snippet}
	 *     <RealContent data={data} />
	 *   </LoadingTier>
	 */
	let { loading, skeleton, slow, children }: LoadingTierProps = $props();

	type Tier = "instant" | "skeleton" | "slow";
	let tier = $state<Tier>("instant");

	$effect(() => {
		if (!loading) {
			tier = "instant";
			return;
		}

		tier = "instant";
		const skeletonTimer = setTimeout(() => {
			tier = "skeleton";
		}, 400);
		const slowTimer = setTimeout(() => {
			tier = "slow";
		}, 2000);

		return () => {
			clearTimeout(skeletonTimer);
			clearTimeout(slowTimer);
		};
	});
</script>

{#if !loading}
	{@render children?.()}
{:else}
	<div data-slot="loading-tier" aria-busy="true" aria-live="polite">
		{#if tier === "skeleton" || tier === "slow"}
			{@render skeleton?.()}
		{/if}
		{#if tier === "slow"}
			{@render slow?.()}
		{/if}
	</div>
{/if}
