import type { Language } from "./types";

/**
 * System-provided starter templates for full_source problems.
 *
 * full_source problems do NOT persist ProblemWorkspaceFile rows; the editor
 * pre-fills these templates client-side when a student first picks a language.
 * multi_file problems still use teacher-uploaded starters; see
 * buildStarterByLanguage() in @nojv/domain for the overlay logic.
 */
export const LANGUAGE_TEMPLATES: Record<Language, string> = {
  c: `#include <stdio.h>

int main() {

    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {

    return 0;
}
`,
  go: `package main

import "fmt"

func main() {

}
`,
  java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {

    }
}
`,
  javascript: ``,
  python: ``,
  rust: `use std::io::{self, Read};

fn main() {

}
`,
  typescript: ``,
};
