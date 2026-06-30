<script lang="ts">
  import { Card } from "$lib/components/primitives/ui/card";
</script>

<svelte:head>
  <title>Advanced Mode Guide · NOJV</title>
  <meta
    name="description"
    content="How to build a NOJV Advanced package with run, grade, scoring, and network configuration."
  />
</svelte:head>

<div class="mx-auto max-w-4xl space-y-8">
  <section class="space-y-3">
    <h1 class="text-title-xl font-bold">Advanced Mode Guide</h1>
    <p class="text-body-lg text-muted-foreground">
      Advanced Mode accepts one package ZIP. The manifest declares scoring, resource limits,
      required student paths, network mode, and required sample expectations. NOJV builds the
      images and runs every sample when staff upload the package, then submissions only run the
      prebuilt images.
    </p>
  </section>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">ZIP structure</h2>
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
    <h2 class="text-title-md font-semibold">Manifest</h2>
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
    <h2 class="text-title-md font-semibold">Runtime contract</h2>
    <ul class="list-disc space-y-2 pl-5 text-body-sm text-muted-foreground">
      <li><code>run</code> reads student files from <code>/workspace/submission/</code>.</li>
      <li><code>run</code> writes outputs under <code>/workspace/output/</code>.</li>
      <li><code>grade</code> reads run output from <code>/workspace/run-output/</code>.</li>
      <li><code>grade</code> writes <code>/workspace/output/result.json</code>.</li>
      <li>Answers and hidden tests belong in <code>grade/</code>, never <code>run/</code>.</li>
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
      Scores must be integers from 0 to <code>scoring.maxScore</code>. <code>accepted</code>
      means full credit, so it must return exactly <code>maxScore</code>. Partial credit should
      use
      <code>wrong_answer</code> with a positive score. Upload is rejected if any manifest sample returns
      a different verdict or score.
    </p>
  </Card>
</div>
