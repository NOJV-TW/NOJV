import type { Language, ProblemOverview } from "@nojv/domain";

export interface ProblemDetail extends ProblemOverview {
  authorHandle: string;
  samples: {
    explanation: string;
    input: string;
    output: string;
  }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  summary: string;
  tags: string[];
  visibility: "private" | "public";
}

export interface ContestDetail {
  endsAt: string;
  frozenScoreboard: boolean;
  mode: string;
  problems: {
    points: number;
    slug: string;
    title: string;
  }[];
  slug: string;
  startsAt: string;
  summary: string;
  telemetrySensitivity: string;
  title: string;
  workspacePolicy: string;
}

export const starterByLanguage: Record<Language, string> = {
  c: `#include <stdio.h>

int main(void) {
  int a = 0;
  int b = 0;
  if (scanf("%d %d", &a, &b) != 2) {
    return 0;
  }
  printf("%d\\n", a + b);
  return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);

  int a = 0;
  int b = 0;
  cin >> a >> b;
  cout << a + b << "\\n";
}
`,
  java: `import java.util.Scanner;

public class Main {
  public static void main(String[] args) {
    Scanner scanner = new Scanner(System.in);
    int a = scanner.nextInt();
    int b = scanner.nextInt();
    System.out.println(a + b);
  }
}
`,
  javascript: `const fs = require("node:fs");

const [a, b] = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);
console.log(a + b);
`,
  python: `a, b = map(int, input().split())
print(a + b)
`,
  rust: `use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let values: Vec<i32> = input.split_whitespace().map(|v| v.parse().unwrap()).collect();
    println!("{}", values[0] + values[1]);
}
`,
  typescript: `import { readFileSync } from "node:fs";

const [a, b] = readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);
console.log(a + b);
`
};
