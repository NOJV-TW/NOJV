# CP Problem Set to NOJV Judge Mapping Plan

Date: 2026-04-01

## Goal

Convert the CP problem sets in `docs/CP-problem` (HW01-HW05, Midterm, Final) into a repeatable NOJV problem authoring flow so most customized problems can be graded automatically.

## Feasibility Summary

- Fully auto-gradable with current NOJV pipeline: 26 problems
- Auto-gradable with small statement adjustment: 3 problems
- Better handled as manual or semi-manual bonus tasks: 5 problems

Notes:

- The 5 manual/semi-manual tasks are all subjective bonus-style questions.
- Core non-bonus algorithm/library/system problems can be covered by existing judge modes plus the newly added custom pipeline stages.

---

## Judge Mode Mapping (NOJV Features)

1. Standard judge (`judgeType=standard`)
   - Use for deterministic stdout match.
2. Checker judge (`judgeType=checker`)
   - Use for floating-point tolerance, flexible formatting, ANSI-decorated output normalization.
3. Interactive judge (`judgeType=interactive`)
   - Use for prompt-response loop style tasks.
4. Function-mode with teacher driver (`submissionType=function` + template/driver)
   - Use for library/API assignments where TA driver calls student functions.
5. Multi-file project submission (`sourceFiles` + `entryFile`)
   - Use for homework requiring multiple source files and Makefile-like organization.
6. Custom script stage (`pipeline.stages: custom-script`)
   - Use for metadata checks, additional rubric checks, and complex output post-processing.
7. Custom scoring stage (`score` stage)
   - Use for partial scoring and weighted rubric logic.
8. Artifact collection (`artifact-collect`)
   - Use when preserving intermediate files/logs is useful for review.

---

## Per-Problem Mapping

## HW01

- 1.1 Print Colorful Words: `standard` or `checker` (strip ANSI then exact match).
- 1.2 Simple Math Problem (alphametic-like): `checker` (accept equivalent solution ordering).
- 1.3 Flip an Octal Number: `standard`.
- 1.4 Poker Hands: `standard`.
- 1.5 Binary Variable (int/uint/float decode): `checker` (format and float display tolerance).
- 1.6 Bonus Makefile question: manual bonus (or build-only custom stage).

## HW02

- 2.1 Golden Ratio series: `checker` (float tolerance).
- 2.2 DNA Sequence DFA: `standard`.
- 2.3 Climate Change prediction (regression): `checker` (numeric tolerance).
- 2.4 Colorful Gradient terminal output: `checker` (normalize ANSI/color tokens).
- 2.5 Tmux multiplexer layout: small statement adjustment recommended.
  - Suggested adjustment: change requirement from real tmux manipulation to generating pane layout command script text.
  - Judge mode: `checker` + optional `custom-script` validation.
- 2.6 Bonus conversion explanation: manual bonus.

## HW03

- 3.1 Riemann library: `function` + teacher driver.
- 3.2 Gacha simulator library: `function` + teacher driver (stateful sequence tests).
- 3.3 GCD with output formats: `function` or `standard`.
- 3.4 Tower of Hanoi: `standard` (exact moves).
- 3.5 Shapez functions: `function` + teacher driver.
- 3.6 Bonus linker explanation: manual bonus.

## HW04

- 4.1 Big Two sorting/check: `function` + teacher driver.
- 4.2 Mahjong hand check: `function` + teacher driver.
- 4.3 k-NN classifier library: `function` + teacher driver.
- 4.4 Bingo game flow: `interactive` (menu-driven scripted interactions).
- 4.5 Machine Learning task: `checker` (numeric tolerance).
- 4.6 Bonus code explanation: manual bonus.

## HW05

- 5.1 Point Mirroring library: `function` + teacher driver.
- 5.2 Gaussian Elimination library: `function` + teacher driver.
- 5.3 Endian converter library: `function` + teacher driver.
- 5.4 DHCP TLV parser: `function` or `standard` (incremental parse behavior tested by driver).
- 5.5 Turing Machine tape transformation: `function` + teacher driver.
- 5.6 Bonus Bob code explanation: manual bonus.

## Midterm

- Mid01 Multiplication with variables: `checker` (multiple valid solutions).
- Mid02 Colorful Card Sequence: `checker` (normalize ANSI and spacing).
- Mid03 Parallelogram library: `function` + teacher driver.
- Mid04 Car Driving emulator: `interactive`.
- Mid05 Regular expression acceptance: `standard` or `interactive`.
- Mid bonus comments: manual bonus.

## Final

- Fin01 Spherical Coordinate library: `function` + teacher driver.
- Fin02 T-score course library: `function` + teacher driver (memory-heavy API sequence).
- Fin03 Memory debug tool: `function` + `checker` + `custom-script`.
  - Normalization needed for dynamic addresses/time fields.
- Fin04 Game of Life: small statement adjustment recommended.
  - Suggested adjustment: run exactly `N` generations and print each frame deterministically (no infinite loop/sleep).
  - Judge mode: `checker` + optional `artifact-collect`.

---

## Teacher Deliverable Contract (Minimum)

For each problem, teacher should provide:

1. Problem metadata
   - id, title, language set, limits, judge mode, score policy.
2. Public/secret testcases
   - input and expected output, or driver test vectors.
3. One of the judge kits
   - Standard kit: expected outputs.
   - Checker kit: checker script.
   - Interactive kit: interactor script.
   - Function kit: driver code + header contract.
4. Optional advanced kit
   - custom-script stage for additional lint/rules.
   - score stage script for weighted grading.
   - artifact patterns when review evidence is needed.

Recommended teacher package layout:

```text
problem/
  manifest.json
  statement.md
  tests/
    public/
    secret/
  checker/
    checker.py
  interactor/
    interactor.py
  harness/
    driver.c
    contract.h
  scripts/
    scoring.py
    post_check.py
```

---

## Three Required Statement Adjustments

1. HW02-2.5 Tmux
   - Current wording implies real tmux environment operations.
   - Adjust to script/text output of layout commands so sandbox can grade deterministically.

2. Final-4 Game of Life
   - Current wording implies endless animation with sleep and clear-screen control codes.
   - Adjust to fixed generation count and deterministic plain-text board output.

3. Final-3 Memory Debug Tool (output format constraints)
   - Clarify that raw pointer addresses and timestamps are canonicalized by checker.
   - Keep logical block content, order, and size as the grading target.

---

## Implementation Backlog for NOJV Authoring

1. Add a problem authoring checklist page for teachers
   - Enforce judge kit completeness by mode.
2. Add reusable checker templates
   - Float checker, ANSI-normalizing checker, unordered-solution checker, memory-dump normalizer.
3. Add reusable function-driver templates
   - C/C++ header+driver harness scaffolds.
4. Add interactive templates
   - Menu-loop and token-stream interactor skeletons.
5. Add CI validation for problem package
   - Validate manifest fields and required files before publish.

---

## Rollout Proposal

1. Phase 1 (fast win)
   - Migrate all function/library problems first (largest volume, highest determinism).
2. Phase 2
   - Migrate standard/checker CLI tasks including float-tolerance tasks.
3. Phase 3
   - Migrate interactive tasks (Bingo, Car Driving, selected regex flow).
4. Phase 4
   - Apply statement-adjusted tasks (tmux and Game of Life) and finalize bonus handling policy.

This phased plan gives high coverage early while keeping statement changes minimal and controlled.
