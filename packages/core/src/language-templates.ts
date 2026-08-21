import type { Language } from "./types";

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
  java: `import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.StringTokenizer;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer tokens = new StringTokenizer(reader.readLine());

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
