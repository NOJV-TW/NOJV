#!/usr/bin/env bash
curl --fail --location --proto '=https' --output "$TMPDIR/tool" "https://example.com/tool/latest/tool-linux-amd64"
printf '%s  %s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$TMPDIR/tool" | sha256sum --check -
