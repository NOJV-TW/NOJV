#!/usr/bin/env bash
curl --fail --location --proto '=https' --tlsv1.2 --output "$TMPDIR/tool" "https://example.com/tool/v1.2.3/tool-linux-amd64"
printf '%s  %s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$TMPDIR/tool" | sha256sum --check -
