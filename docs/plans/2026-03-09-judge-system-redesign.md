# Judge System Redesign

## Overview

Redesign the submission and judging system to support multiple submission modes and evaluation methods.

## Scope (Phase 1)

### Submission Modes

1. **Function mode** (`function`) — LeetCode-style, user only edits function/class body
2. **Full source mode** (`full_source`) — user submits complete source code (current behavior)

### Judge Types

1. **Standard** (`standard`) — stdin/stdout exact comparison (current behavior)
2. **Custom checker** (`checker`) — judge script decides correctness
3. **Interactive** (`interactive`) — interactor script communicates with user program via pipes

File I/O scenarios (e.g. generate an image, write CSV) are handled via checker — the checker script inspects files left in the sandbox.

### Out of Scope (Phase 2+)

- Workspace mode (persistent container, entry point submission)
- Auto-generated drivers (LeetCode-style declarative type system)
- Token-based / float-tolerance built-in comparators

---

## Data Model Changes

### Problem (modify existing)

New fields:

| Field              | Type                                       | Default         | Description                             |
| ------------------ | ------------------------------------------ | --------------- | --------------------------------------- |
| `judgeType`        | `"standard" \| "checker" \| "interactive"` | `"standard"`    | Evaluation method                       |
| `submissionType`   | `"function" \| "full_source"`              | `"full_source"` | What the user submits                   |
| `checkerScript`    | `string?`                                  | `null`          | Python/bash script for checker mode     |
| `interactorScript` | `string?`                                  | `null`          | Python/bash script for interactive mode |

Constraints:

- `judgeType = "checker"` requires `checkerScript` to be set
- `judgeType = "interactive"` requires `interactorScript` to be set
- `checkerScript` and `interactorScript` are mutually exclusive

### ProblemTemplate (new model)

One row per problem × language. Only required when `submissionType = "function"`.

| Field             | Type            | Description                                           |
| ----------------- | --------------- | ----------------------------------------------------- |
| `id`              | `cuid`          | Primary key                                           |
| `problemId`       | `FK → Problem`  |                                                       |
| `language`        | `Language` enum | `c`, `cpp`, `java`, `python`, `javascript`, `rust`    |
| `driverCode`      | `string`        | Full source with insertion marker                     |
| `templateCode`    | `string`        | Initial code shown to user (editable area)            |
| `insertionMarker` | `string`        | Placeholder in driverCode, default `// __USER_CODE__` |

Unique constraint: `(problemId, language)`

### Testcase (modify existing)

| Field            | Change              | Description                                                 |
| ---------------- | ------------------- | ----------------------------------------------------------- |
| `expectedStdout` | Required → Optional | Not needed for checker/interactive                          |
| `inputFiles`     | New, `Json?`        | Extra files to place in sandbox, e.g. `{"data.csv": "..."}` |

### Submission (no schema change)

`sourceCode` meaning changes based on `submissionType`:

- `function` → only the function/class body
- `full_source` → complete source code (unchanged)

---

## Execution Flow

### 1. Source Code Assembly

```
if submissionType == "function":
    template = ProblemTemplate.find(problemId, language)
    fullSource = template.driverCode.replace(template.insertionMarker, submission.sourceCode)
else:
    fullSource = submission.sourceCode
```

### 2. Sandbox Setup

For all judge types:

1. Write `fullSource` to workspace as source file
2. Write `stdin` (from testcase) to `stdin.txt`
3. If `inputFiles` exists, write each file to workspace
4. If checker mode, write `checkerScript` to `checker.py`
5. If interactive mode, write `interactorScript` to `interactor.py`

### 3. Evaluation by Judge Type

#### Standard

```
1. Compile user program (if compiled language)
2. Run: ./program < stdin.txt > stdout.txt
3. Compare stdout.txt with expectedStdout (normalize CRLF, trim trailing whitespace)
4. Exact match → AC, mismatch → WA
```

#### Checker

```
1. Compile and run user program: ./program < stdin.txt > stdout.txt
2. Write expectedStdout to expected.txt (if provided)
3. Run: python3 checker.py stdin.txt expected.txt stdout.txt
4. Exit code 0 → AC, exit code 1 → WA
5. Checker stdout → score (0~100, optional partial credit)
6. Checker stderr → feedback message to user
```

#### Interactive

```
1. Compile user program (if compiled language)
2. Write testcase stdin to input.txt
3. Run interactor and user program connected via pipes:
   interactor.py stdout → user program stdin
   user program stdout → interactor.py stdin
4. Invocation: python3 interactor.py input.txt
5. Exit code 0 → AC, exit code 1 → WA
6. Interactor stderr line 1 → score (0~100)
7. Interactor stderr line 2+ → feedback
```

---

## Checker Script Guide (for problem authors)

### Interface

```bash
python3 checker.py <input_path> <expected_output_path> <user_output_path>
```

- `input_path`: path to the testcase input (stdin content)
- `expected_output_path`: path to expected output (may be empty file if not provided)
- `user_output_path`: path to user program's stdout

### Return Values

- **Exit code 0**: Accepted
- **Exit code 1**: Wrong Answer
- **stdout** (optional): integer 0~100 for partial scoring
- **stderr** (optional): feedback message shown to user

### Example: Float Tolerance Checker

```python
import sys

def main():
    input_path, expected_path, user_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(expected_path) as f:
        expected = float(f.read().strip())
    with open(user_path) as f:
        actual = float(f.read().strip())

    if abs(expected - actual) < 1e-6:
        sys.exit(0)  # AC
    else:
        print(f"Expected {expected}, got {actual}", file=sys.stderr)
        sys.exit(1)  # WA

if __name__ == "__main__":
    main()
```

### Example: File Output Checker

```python
import sys
import os

def main():
    # User program should have created output.png in the working directory
    if not os.path.exists("output.png"):
        print("output.png not found", file=sys.stderr)
        sys.exit(1)

    # Check file size, format, content, etc.
    size = os.path.getsize("output.png")
    if size > 0:
        sys.exit(0)
    else:
        print("output.png is empty", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
```

---

## Interactor Script Guide (for problem authors)

### Interface

```bash
python3 interactor.py <input_path>
```

The interactor communicates with the user program through pipes:

- **Interactor stdout** → User program stdin
- **User program stdout** → Interactor stdin

### Return Values

- **Exit code 0**: Accepted
- **Exit code 1**: Wrong Answer
- **stderr line 1**: score (0~100)
- **stderr line 2+**: feedback message

### Example: Guess the Number

```python
import sys

def main():
    input_path = sys.argv[1]
    with open(input_path) as f:
        secret = int(f.read().strip())

    for _ in range(20):  # max 20 guesses
        # Read user's guess
        guess = int(input())

        if guess == secret:
            print("correct", flush=True)
            print("100", file=sys.stderr)
            sys.exit(0)
        elif guess < secret:
            print("higher", flush=True)
        else:
            print("lower", flush=True)

    # Ran out of guesses
    print("0", file=sys.stderr)
    print("Did not guess within 20 attempts", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    main()
```

---

## Driver Code Guide (for problem authors)

### When to Write

Only required for `submissionType = "function"` problems. Each supported language needs its own driver.

### Structure

1. Place the insertion marker (`// __USER_CODE__`) where user code should be injected
2. Write driver code that reads input, calls the user's function/class, and outputs results
3. Write template code showing the user what to implement

### Example: Two Sum (C++)

**driverCode:**

```cpp
#include <vector>
#include <iostream>
using namespace std;

// __USER_CODE__

int main() {
    int n, target;
    cin >> n >> target;
    vector<int> nums(n);
    for (auto& x : nums) cin >> x;

    Solution sol;
    vector<int> result = sol.twoSum(nums, target);
    for (int i = 0; i < result.size(); i++) {
        if (i > 0) cout << " ";
        cout << result[i];
    }
    cout << endl;
    return 0;
}
```

**templateCode:**

```cpp
class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // Write your solution here
    }
};
```

**insertionMarker:** `// __USER_CODE__`

### Rules

- The marker must appear exactly once in driverCode
- templateCode is what the user sees in the editor — it should compile when inserted (even if logic is incomplete)
- Driver handles all I/O; user code should NOT read stdin or write stdout
- For Python, use `# __USER_CODE__` as marker
