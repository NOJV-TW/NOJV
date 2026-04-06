# Judge Pipeline

The judge pipeline is the evaluation framework that compiles, executes, and scores submissions. It runs as a Temporal activity inside the worker service.

## Default Pipeline

Most problems use the default three-stage pipeline:

```
compile → execute → check
```

1. **compile**: Compile source code (language-specific)
2. **execute**: Run binary against each testcase with time/memory limits
3. **check**: Compare output to expected output (diff, checker, or interactive)

## Extended Pipeline

Problems can define a custom `pipelineConfig` with additional stages:

```
compile → static-analysis → execute → check → score → artifact-collect → custom-script
```

All stages are optional except `compile`, `execute`, and `check`. Each stage has `continueOnFail` to control whether failure halts the pipeline.

## Pipeline Stages

### compile

Compiles source code using the language-specific compiler. For interpreted languages (Python, JavaScript), this is a syntax check.

### static-analysis

Pre-execution code analysis:

- **Banned functions**: Reject submissions using forbidden functions (e.g., `system`, `exec`)
- **Banned imports**: Reject forbidden imports (e.g., `import os`)
- **Banned patterns**: Regex-based pattern matching with custom messages
- **Linter**: Run external linter (pylint, eslint, etc.) with optional fail-on-error

### execute

Run compiled code against testcases in the sandbox:

- Per-testcase stdin/stdout
- Time limit (100ms - 30s)
- Memory limit (16 - 1024 MB)
- Captures stdout, stderr, exit code, runtime, memory usage

### check

Compare output to expected:

- **standard**: Exact diff comparison
- **checker**: Teacher-provided script receives (input, expected, actual) and returns verdict
- **interactive**: Bidirectional communication between submission and interactor script

### score

Custom scoring via teacher-provided script (Python or Bash):

- Receives testcase results, submission metadata
- Returns 0-100 score with optional feedback
- Use cases: late penalty, resource cost scoring, partial credit
- Timeout: configurable (default 30s)

### artifact-collect

Collect output files from sandbox:

- Glob patterns for matching (e.g., `*.png`, `output/*.csv`)
- Max total size limit (default 10 MB)
- Collected artifacts stored and accessible via submission detail

### custom-script

Arbitrary teacher-provided script:

- Languages: Python, C, C++, Go, Rust
- Run timing: `before-compile`, `after-compile`, or `after-check`
- Returns pass/fail, exit code, feedback, and optional metadata
- Use cases: style checks, documentation grading, custom validation

## Judge Types

### standard

Default. Compares submission stdout to expected stdout line-by-line (trimmed whitespace).

### checker

Teacher provides a `checkerScript` that receives three arguments:

1. Input file path
2. Expected output file path
3. Actual output file path

Returns exit code 0 for AC, non-zero for WA. Can output feedback to stderr.

### interactive

Teacher provides an `interactorScript` that communicates bidirectionally with the submission via stdin/stdout pipes. The interactor controls the test protocol and determines the verdict.

## Submission Types

### full_source

User submits complete source code. The entire file is compiled and executed.

### function

User submits only a function body. The platform provides:

- **Driver code**: Test harness that calls the user's function
- **Template code**: Boilerplate with an insertion marker (`// __USER_CODE__`)

The system merges user code into the template at the insertion marker before compilation.

## Supported Languages

| Language   | Source File | Extension | Notes            |
| ---------- | ----------- | --------- | ---------------- |
| C          | main.c      | c         | gcc              |
| C++        | main.cpp    | cpp       | g++              |
| Go         | main.go     | go        | go build         |
| Java       | Main.java   | java      | javac + java     |
| JavaScript | main.mjs    | mjs       | Node.js ESM      |
| Python     | main.py     | py        | Python 3         |
| Rust       | main.rs     | rs        | rustc            |
| TypeScript | main.ts     | ts        | Node.js with tsx |

## Sandbox Execution

Code runs in an isolated container:

| Setting | Default                   | Range                                  |
| ------- | ------------------------- | -------------------------------------- |
| CPU     | 1 core                    | Configurable                           |
| Memory  | 256 MB                    | 16 - 1024 MB                           |
| PIDs    | 64                        | Configurable                           |
| Network | none                      | Configurable via `networkAccessConfig` |
| Timeout | Per-problem `timeLimitMs` | 100ms - 30s                            |

Security hardening:

- `cap-drop ALL` — No Linux capabilities
- `no-new-privileges` — Cannot escalate
- Read-only rootfs with `tmpfs /tmp`
- seccomp profile restrictions
- Docker (local) or Kubernetes Jobs (production)

### Network Access

For problems that require network access (e.g., API consumption, web scraping):

- Firewall rules: allow specific hosts/ports/protocols
- Sidecar services: co-located containers (e.g., mock API server)
- Traffic logging for audit

## Testcase Organization

Testcases are grouped into **TestcaseSets** (e.g., "sample", "subtask-1", "hidden"):

- Each set has a **weight** for subtask scoring
- Each testcase has an **ordinal** for execution order
- Sample testcases (`isHidden: false`) are visible to users before submission
- Hidden testcases are used for final scoring

### Subtask Scoring (IOI Mode)

In IOI scoring mode:

- Each TestcaseSet represents a subtask
- Subtask score = `weight * (passed / total)` testcases in that set
- Total score = sum of all subtask scores
- Results stored in `Submission.subtaskResults`

## Sandbox Verdicts

| Verdict               | Code | Meaning                         |
| --------------------- | ---- | ------------------------------- |
| Accepted              | AC   | Output matches expected         |
| Wrong Answer          | WA   | Output differs from expected    |
| Time Limit Exceeded   | TLE  | Execution exceeded time limit   |
| Memory Limit Exceeded | MLE  | Execution exceeded memory limit |
| Runtime Error         | RE   | Non-zero exit code              |
| System Error          | SE   | Internal sandbox failure        |

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Temporal Workflows](TEMPORAL.md)
- [Database Schema](DATABASE.md)
- [Judge Pipeline Extensibility Spec](plans/completed/SPEC.md)
