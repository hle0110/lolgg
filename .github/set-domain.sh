#!/usr/bin/env bash
set -eu
NEW=${1:?usage: bash .github/set-domain.sh https://your-domain.com/}
case "$NEW" in */) ;; *) NEW="$NEW/" ;; esac
OLD="https://hle0110.github.io/lolgg/"
NEW_PATH=$(printf '%s' "$NEW" | sed -E 's#^https?://[^/]+##')
NEW_BARE=$(printf '%s' "$NEW" | sed -E 's#^https?://##; s#/$##')
for f in index.html sitemap.xml README.md; do
  sed -i "s#${OLD}#${NEW}#g; s#hle0110.github.io/lolgg#${NEW_BARE}#g" "$f"
done
sed -i "s#\"/lolgg/#\"${NEW_PATH}#g" 404.html
echo "Now using $NEW (404 page paths: $NEW_PATH)"
grep -rn "hle0110.github.io/lolgg\|\"/lolgg/" index.html sitemap.xml README.md 404.html || echo "No old addresses left."
