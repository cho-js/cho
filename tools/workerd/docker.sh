#!/bin/sh
# Runs tools/workerd/run.sh in a container: the repository is mounted
# read-only, and nothing is installed on the machine. The arguments are those
# of run.sh.
set -eu

repo=$(cd "$(dirname "$0")/../.." && pwd)

docker run --rm -v "$repo:/repo:ro" node:24-bookworm-slim sh -c '
  # workerd needs the certificates of the system.
  apt-get update -qq > /dev/null && apt-get install -y -qq ca-certificates > /dev/null
  REPO=/repo WORK=/work /repo/tools/workerd/run.sh "$@"
' run "$@"
