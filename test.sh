# used to run tests in all runtimes
set -e

echo "Deno run tests"
deno test --allow-env --allow-net --allow-read --allow-write --allow-run

echo "Bun run tests"
bun test

echo "Node.js run tests"
tsx --test