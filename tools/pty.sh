#!/bin/sh
# Runs the questions of @chojs/prompt in a real terminal, on each runtime.
#
# The tests of the package ask their questions on a scripted terminal. This
# asks them on a pseudo-terminal, made by script(1): the keys are bytes on a
# real input, in raw mode, read by the node:readline of the runtime. It runs
# examples/prompt.ts twice: once to the end, once cancelled with Ctrl+C.
#
#   tools/pty.sh                 Deno, Node.js and Bun
#   tools/pty.sh deno node       these runtimes only
#
# Each key is sent when the question it answers is on the screen, not after a
# fixed time: a slow start does not fail the run.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The command of a runtime.
command_of() {
  case "$1" in
    deno) echo "deno run examples/prompt.ts" ;;
    node) echo "npx --yes tsx examples/prompt.ts" ;;
    bun) echo "bun examples/prompt.ts" ;;
    *) echo "unknown runtime: $1" >&2; exit 2 ;;
  esac
}

# in_terminal <command>: run a command in a pseudo-terminal. Its keys are the
# input, and its screen is the output. script(1) of Linux and the one of
# macOS take their arguments differently.
in_terminal() {
  if script --version > /dev/null 2>&1; then
    script -qec "$1" /dev/null
  else
    # shellcheck disable=SC2086
    script -q /dev/null $1
  fi
}

# wait_for <file> <text>: wait until the screen shows a text.
wait_for() {
  tries=0
  until grep -qF -- "$2" "$1" 2> /dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 300 ]; then
      echo "timeout: '$2' was never shown" >&2
      return 1
    fi
    sleep 0.1
  done
  # the question is drawn, and its keys are read
  sleep 0.2
}

# plain <file>: the screen without its escape codes: the text alone.
plain() {
  esc=$(printf '\033')
  sed "s/$esc\\[[0-9;?]*[A-Za-z]//g" "$1"
}

failed=0
check() {
  # check <runtime> <name> <file> <text>
  if plain "$3" | grep -qF -- "$4"; then
    echo "ok      $1: $2"
  else
    echo "FAILED  $1: $2 :: expected '$4' in:"
    sed 's/^/    /' "$3" | cat -v
    failed=1
  fi
}

for runtime in ${*:-deno node bun}; do
  command=$(command_of "$runtime")

  # 1. Every question, to the end: a text that is refused once, the second
  # choice of the list, and a no.
  screen="$work/$runtime-answers"
  : > "$screen"
  {
    wait_for "$screen" "Project name"
    printf 'My App\r'
    wait_for "$screen" "Lower case letters"
    printf '\025shop\r' # Ctrl+U erases the line
    wait_for "$screen" "What are you building"
    printf '\033[B\r' # the down arrow
    wait_for "$screen" "Initialize a git repository"
    printf 'n\r'
    wait_for "$screen" '"git"'
  } | in_terminal "$command" > "$screen" 2>&1 || true
  check "$runtime" "three answers" "$screen" \
    '{"name":"shop","kind":"cli","git":false}'

  # 2. Ctrl+C on the second question.
  screen="$work/$runtime-cancel"
  : > "$screen"
  {
    wait_for "$screen" "Project name"
    printf '\r' # an empty line: the default
    wait_for "$screen" "What are you building"
    printf '\003'
    wait_for "$screen" "Cancelled"
  } | in_terminal "$command" > "$screen" 2>&1 || true
  check "$runtime" "the default of an empty line" "$screen" \
    "✔ Project name · my-app"
  check "$runtime" "Ctrl+C cancels" "$screen" "Cancelled."
done

exit "$failed"
