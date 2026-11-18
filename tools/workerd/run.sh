#!/bin/sh
# Runs the tests of CHO in workerd, the runtime of Cloudflare Workers: one
# Worker for each test file. See README.md.
#
#   tools/workerd/run.sh             every test file, and the Workers of workers/
#   tools/workerd/run.sh <file>...   these test files only
#
# REPO is the repository (default: the one this file is in). WORK is where
# esbuild and workerd are installed and the bundles are written (default: a
# temporary folder).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-$(cd "$here/../.." && pwd)}
WORK=${WORK:-$(mktemp -d)}

mkdir -p "$WORK"
cp "$here/build.mjs" "$here/test-api.js" "$here/package.json" "$WORK/"
cd "$WORK"
if [ ! -d node_modules/workerd ]; then
  npm install --no-audit --no-fund --loglevel=error
fi

cd "$REPO"
if [ $# -gt 0 ]; then
  files="$*"
  workers=""
else
  # The packages that run on Workers.
  files=$(ls core/*_test.ts core/di/*_test.ts core/utils/*_test.ts \
    web/*_test.ts message/*_test.ts vendor/cho/*_test.ts \
    vendor/hono/*_test.ts extras/openapi/*_test.ts)
  workers=$(ls tools/workerd/workers/*.ts)
fi
cd "$WORK"

pass=0 fail=0 skip=0 broken=0 count=0
run() {
  # run <file> <mode>
  count=$((count + 1))
  if ! node build.mjs "$REPO" "$1" "$2" > build.log 2>&1; then
    broken=$((broken + 1))
    echo "NOT BUILT $1 :: $(head -c 800 build.log | tr '\n' ' ')"
    return
  fi
  out=$(npx workerd test config.capnp 2>&1 || true)
  result=$(echo "$out" | grep '^RESULT ' | tail -1 || true)
  if [ -z "$result" ]; then
    broken=$((broken + 1))
    echo "NOT LOADED $1 :: $(echo "$out" | head -c 800 | tr '\n' ' ')"
    return
  fi
  echo "$out" | grep '^FAIL ' || true
  p=$(echo "$result" | sed 's/.*"pass":\([0-9]*\).*/\1/')
  f=$(echo "$result" | sed 's/.*"fail":\([0-9]*\).*/\1/')
  s=$(echo "$result" | sed 's/.*"skip":\([0-9]*\).*/\1/')
  pass=$((pass + p)) fail=$((fail + f)) skip=$((skip + s))
  echo "$1: $p passed, $f failed, $s skipped"
}

for file in $files; do run "$file" test; done
for file in $workers; do run "$file" worker; done

echo
echo "workerd $(npx workerd --version | sed 's/workerd //'): $count files, $pass passed, $fail failed, $skip skipped, $broken not run"
[ "$fail" -eq 0 ] && [ "$broken" -eq 0 ]
