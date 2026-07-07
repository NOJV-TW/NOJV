<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
</script>

<svelte:head>
  <title>{m.guideAdvanced_title()} · NOJV</title>
  <meta name="description" content={m.guideAdvanced_metaDescription()} />
</svelte:head>

<div class="mx-auto max-w-4xl space-y-8">
  <section class="space-y-3">
    <h1 class="text-title-xl font-bold">{m.guideAdvanced_title()}</h1>
    <p class="text-body-lg text-muted-foreground">
      {m.guideAdvanced_intro()}
    </p>
  </section>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">{m.guideAdvanced_zipStructureTitle()}</h2>
    <pre class="overflow-auto rounded bg-black/85 p-4 text-caption text-white">{`advanced.zip
  metadata.yaml
  run/
    Dockerfile
    runner.py
  grade/
    Dockerfile
    grader.py
    answers/
  service/
    Dockerfile
    service.py
  samples/
    full-credit.zip`}</pre>
  </Card>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">{m.guideAdvanced_manifestTitle()}</h2>
    <pre class="overflow-auto rounded bg-black/85 p-4 text-caption text-white">{`version: 1

problem:
  title: Advanced Sum
  difficulty: medium
  visibility: private
  statement: |
    Read two integers and output their sum.
  inputFormat: |
    One line with two integers a and b.
  outputFormat: |
    One integer: a + b.
  examples:
    - input: |
        1 2
      output: |
        3
  tags:
    - advanced

scoring:
  maxScore: 250

resources:
  timeLimitMs: 30000
  memoryLimitMb: 1024

student:
  requiredPaths:
    - main.py

network:
  mode: none
  allowlist: []

samples:
  - name: full-credit
    submission: samples/full-credit.zip
    expect:
      verdict: accepted
      score: 250`}</pre>
  </Card>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">{m.guideAdvanced_runtimeTitle()}</h2>
    <ul class="list-disc space-y-2 pl-5 text-body-sm text-muted-foreground">
      <li>{m.guideAdvanced_runtimeItem1()}</li>
      <li>{m.guideAdvanced_runtimeItem2()}</li>
      <li>{m.guideAdvanced_runtimeItem3()}</li>
      <li>{m.guideAdvanced_runtimeItem4()}</li>
      <li>{m.guideAdvanced_runtimeItem5()}</li>
    </ul>
  </Card>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">result.json</h2>
    <pre class="overflow-auto rounded bg-black/85 p-4 text-caption text-white">{`{
  "verdict": "wrong_answer",
  "score": 120,
  "feedback": "Passed 6 of 10 rubric checks"
}`}</pre>
    <p class="text-body-sm text-muted-foreground">
      {m.guideAdvanced_resultNote()}
    </p>
  </Card>
</div>
