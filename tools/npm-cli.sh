#!/bin/sh
# Builds the npm package of `cho`, and uses it as a user of npm would.
#
# The package is one file, cli/npm/cho.js, that Node.js runs with no
# TypeScript runner. This builds it, and runs it in a temporary folder: every
# answer is a flag, and nothing is installed.
#
#   tools/npm-cli.sh
#
# It needs Deno, which builds the file, and Node.js, which runs it. It runs
# on Linux, on macOS and on Windows (in the shell of Git).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
root=$(pwd)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cho="$root/cli/npm/cho.js"

deno task --cwd cli npm
node "$cho" --help

# a workspace, written by the file a user would get
(cd "$work" && node "$cho" new shop \
  --kind web --runtime node --project api --apps-dir apps \
  --no-git --no-install)
test -f "$work/shop/cho.json"
test -f "$work/shop/.npmrc"
test -f "$work/shop/apps/api/main.ts"

# a library, added to it from a folder of the workspace
(cd "$work/shop/apps/api" && node "$cho" add shared --type library --no-install)
test -f "$work/shop/libs/shared/mod.ts"
grep -q '"shared"' "$work/shop/cho.json"

# a message consumer: another kind of application, with the adapter of Kafka
(cd "$work/shop" && node "$cho" add worker --kind message --no-install)
test -f "$work/shop/apps/worker/main.ts"
grep -q '"@chojs/vendor-kafka"' "$work/shop/apps/worker/package.json"

# a controller, written in the application
(cd "$work/shop" && node "$cho" generate controller userProfile \
  --project api --yes)
test -f "$work/shop/apps/api/user-profile.ts"
test -f "$work/shop/apps/api/user-profile_test.ts"

# a file of the workspace has the line endings of the tool, on every system
if grep -q "$(printf '\r')" "$work/shop/apps/api/main.ts"; then
  echo "apps/api/main.ts has Windows line endings" >&2
  exit 1
fi

# packs the package and lists its files, and asks npm nothing:
# `npm publish --dry-run` fails when the version is already on npm, which it
# is from a release to the next
npm pack --dry-run ./cli/npm

echo "ok: the npm package of cho"
