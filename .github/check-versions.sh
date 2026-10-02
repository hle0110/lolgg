#!/usr/bin/env bash
set -u
BASE=${1:-}
if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$BASE" 2>/dev/null; then
  echo "No base commit to compare, skipping version check"
  exit 0
fi
changed=$(git diff --name-only "$BASE" HEAD)
fail=0
for f in app.js esports.css style.css; do
  if echo "$changed" | grep -qx "$f"; then
    old=$(git show "$BASE:index.html" | grep -o "$f?v=[0-9a-z]*")
    new=$(grep -o "$f?v=[0-9a-z]*" index.html)
    if [ "$old" = "$new" ]; then echo "FAIL: $f changed but index.html still has $new"; fail=1; else echo "ok: $f $old -> $new"; fi
  fi
done
if echo "$changed" | grep -qxE 'app.js|esports.css|style.css|index.html|manifest.json'; then
  old=$(git show "$BASE:sw.js" | grep -o 'CACHE_NAME = "[^"]*"')
  new=$(grep -o 'CACHE_NAME = "[^"]*"' sw.js)
  if [ "$old" = "$new" ]; then echo "FAIL: shell files changed but sw.js still has $new"; fail=1; else echo "ok: $old -> $new"; fi
fi
exit $fail
