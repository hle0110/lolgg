#!/usr/bin/env bash
set -u
REPO=$(pwd)
T=/tmp/jsdomtest
mkdir -p "$T"
cp app.js index.html esports.css style.css sw.js manifest.json terms.html privacy.html credits.html .github/set-domain.sh "$T"/
cp .github/tests/*.js "$T"/
cp -r .github/tests/fixtures "$T"/
cd "$T"
[ -d node_modules/jsdom ] || npm install --silent --no-save jsdom acorn > /dev/null
run_one() {
  f=$1
  t=40
  [ "$f" = run_background_traffic_regression.js ] && t=120
  out=$(timeout "$t" node "$f" 2>&1)
  line=$(printf '%s\n' "$out" | grep -E '^[0-9]+/[0-9]+ checks passed' | tail -1)
  n=${line%%/*}
  rest=${line#*/}
  m=${rest%% *}
  if [ -z "$line" ] || [ "$n" != "$m" ] || printf '%s' "$out" | grep -q '✗'; then
    printf 'FAIL %s\n%s\n' "$f" "$(printf '%s\n' "$out" | tail -20)"
    return 1
  fi
  printf 'ok   %s (%s)\n' "$f" "${line%% checks*}"
}
export -f run_one
ls run_*.js | xargs -P 8 -I{} bash -c 'run_one {}' > results.txt
cat results.txt
fail=0
grep -q '^FAIL' results.txt && fail=1
REPO="$REPO" node -e '
const acorn = require("acorn");
const fs = require("fs");
let bad = 0;
for (const f of ["app.js", "sw.js"]) {
  const comments = [];
  acorn.parse(fs.readFileSync(process.env.REPO + "/" + f, "utf8"), { ecmaVersion: 2022, onComment: comments });
  console.log(`${f}: ${comments.length} comments`);
  bad += comments.length;
}
process.exit(bad ? 1 : 0);
' || fail=1
echo "$(grep -c '^ok' results.txt) passed, $(grep -c '^FAIL' results.txt) failed"
exit $fail
