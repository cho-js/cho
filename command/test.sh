echo "Deno run tests"
deno test --allow-env

echo "Bun run tests"
bun test

echo "Node.js run tests"
tsx --test