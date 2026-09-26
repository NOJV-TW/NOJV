<script lang="ts">
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { formatVerdictLabel, verdictBadgeVariant } from "$lib/utils/verdict-style";

  let { verdict }: { verdict: string } = $props();
</script>

<Badge variant={verdictBadgeVariant(verdict)} size="sm">{formatVerdictLabel(verdict)}</Badge>
