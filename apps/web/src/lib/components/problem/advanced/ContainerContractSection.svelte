<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  const dockerfileExample = `FROM python:3.12-slim
WORKDIR /grader

# 把測資 + 評分腳本打包進 image
COPY testcases/ ./testcases/
COPY grader.py ./

CMD ["python", "/grader/grader.py"]`;

  const graderExample = `# grader.py — 範例:
# 系統會把學生檔案放在 /workspace/submission/,
# 你只要把最終結果寫到 /workspace/output/result.json 即可。
import json, os, subprocess
from pathlib import Path

SUBMISSION = Path("/workspace/submission")
OUTPUT = Path("/workspace/output/result.json")
TESTCASES = Path("/grader/testcases")

def run_case(entry: Path, stdin: str, expected: str, budget_s: float) -> bool:
    r = subprocess.run(
        ["python", str(entry)],
        input=stdin, capture_output=True, text=True, timeout=budget_s,
    )
    return r.stdout.strip() == expected.strip()

entry = SUBMISSION / "main.py"   # 或依 $LANGUAGE 分派
cases = sorted(TESTCASES.glob("case-*.json"))
passed = 0
details = []
for i, case_file in enumerate(cases):
    case = json.loads(case_file.read_text())
    ok = run_case(entry, case["stdin"], case["expected"], budget_s=2.0)
    passed += 1 if ok else 0
    details.append({
        "index": i,
        "verdict": "AC" if ok else "WA",
    })

total = len(cases)
score = int(round(passed / total * 100)) if total else 0
OUTPUT.write_text(json.dumps({
    "score": score,
    "verdict": "accepted" if passed == total else "wrong_answer",
    "feedback": f"{passed}/{total} testcases passed",
    "testcases": details,
}))`;

  let copied = $state<"dockerfile" | "grader" | null>(null);

  function copy(kind: "dockerfile" | "grader", text: string) {
    void navigator.clipboard.writeText(text);
    copied = kind;
    setTimeout(() => {
      if (copied === kind) copied = null;
    }, 1_500);
  }
</script>

<section class="space-y-4">
  <header class="space-y-1">
    <h3 class="text-body-lg font-semibold">{m.admin_containerContract()}</h3>
    <p class="text-body-sm text-muted-foreground">
      {m.admin_containerContractHint()}
    </p>
  </header>

  <div class="grid gap-4 md:grid-cols-2">
    <div class="rounded-lg border border-border-subtle bg-muted/30 p-2 text-body-sm">
      <p class="font-semibold">{m.admin_systemProvides()}</p>
      <ul class="mt-2 space-y-1 text-body-sm text-muted-foreground">
        <li>
          <code class="rounded bg-muted px-1 py-0.5 text-caption">/workspace/submission/</code>
          ← {m.admin_submissionFiles()}
        </li>
        <li>
          <code class="rounded bg-muted px-1 py-0.5 text-caption">/workspace/meta.json</code>
          ← {m.admin_metaJson()}
        </li>
        <li>env <code class="rounded bg-muted px-1 py-0.5 text-caption">SUBMISSION_ID</code></li>
        <li>env <code class="rounded bg-muted px-1 py-0.5 text-caption">LANGUAGE</code></li>
      </ul>
      <p class="mt-3 text-caption text-muted-foreground">
        {m.admin_noNetwork({ flag: '--network=none' })}
      </p>
    </div>

    <div class="rounded-lg border border-border-subtle bg-muted/30 p-2 text-body-sm">
      <p class="font-semibold">{m.admin_mustOutput()}</p>
      <ul class="mt-2 space-y-1 text-body-sm text-muted-foreground">
        <li>
          <code class="rounded bg-muted px-1 py-0.5 text-caption">/workspace/output/result.json</code>
        </li>
      </ul>
      <pre
        class="mt-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-caption leading-5 text-foreground">{`{
  "score": 85,               // 0 ~ 100
  "verdict": "wrong_answer", // accepted | wrong_answer | tle | mle | re | ce
  "feedback": "5/6 passed",  // optional
  "testcases": [             // optional per-case detail
    { "index": 0, "verdict": "AC", "runtimeMs": 23 }
  ]
}`}</pre>
      <p class="mt-3 text-caption text-muted-foreground">
        {@html m.admin_exitCodeWarning({ file: '<code>result.json</code>' })}
      </p>
    </div>
  </div>

  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-body-sm font-semibold">{m.admin_exampleDockerfile()}</p>
      <button
        type="button"
        class="rounded-full border border-border px-3 py-1 text-caption font-medium transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
        onclick={() => copy("dockerfile", dockerfileExample)}
      >
        {copied === "dockerfile" ? m.common_copied() : m.common_copy()}
      </button>
    </div>
    <pre
      class="overflow-x-auto rounded-lg border border-border-subtle bg-muted/40 p-2 font-mono text-caption leading-5 text-foreground">{dockerfileExample}</pre>
  </div>

  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <p class="text-body-sm font-semibold">{m.admin_exampleGrader()}</p>
      <button
        type="button"
        class="rounded-full border border-border px-3 py-1 text-caption font-medium transition-[background-color] duration-fast ease-out-soft hover:bg-accent"
        onclick={() => copy("grader", graderExample)}
      >
        {copied === "grader" ? m.common_copied() : m.common_copy()}
      </button>
    </div>
    <pre
      class="overflow-x-auto rounded-lg border border-border-subtle bg-muted/40 p-2 font-mono text-caption leading-5 text-foreground">{graderExample}</pre>
  </div>
</section>
