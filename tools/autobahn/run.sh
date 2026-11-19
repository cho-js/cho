#!/bin/sh
# Runs the Autobahn test suite, the usual conformance check of a WebSocket
# server (RFC 6455), against the echo server of this folder. See README.md.
#
#   tools/autobahn/run.sh            on Node.js: the protocol of web/ws-protocol.ts
#   tools/autobahn/run.sh deno       on Deno: its own protocol
#   tools/autobahn/run.sh bun        on Bun: its own protocol
#
# It needs Docker, for the suite (the image crossbario/autobahn-testsuite).
# The server runs on the machine, and the suite reaches it from its
# container.
#
# CASES is the list of cases, as JSON. Default: all of them.
# EXCLUDE is the list of cases that are left out, as JSON. Default: the
#   cases of compression (12.* and 13.*), which the server does not have.
# HOST is the name of the machine, seen from a container. Default:
#   host.docker.internal.
# PORT is the port of the server. Default: 9001.
# WORK is where the report is written. Default: a temporary folder.
set -eu

runtime=${1:-node}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
CASES=${CASES:-'["*"]'}
EXCLUDE=${EXCLUDE:-'["12.*", "13.*"]'}
HOST=${HOST:-host.docker.internal}
PORT=${PORT:-9001}
WORK=${WORK:-$(mktemp -d)}

case "$runtime" in
  node) start="npx --yes tsx tools/autobahn/server.ts" ;;
  deno) start="deno run --allow-net --allow-env tools/autobahn/server.ts" ;;
  bun) start="bun tools/autobahn/server.ts" ;;
  *) echo "unknown runtime: $runtime (node, deno or bun)" >&2; exit 2 ;;
esac
# START replaces the command that starts the server, to compare with another
# echo server on the same port.
start=${START:-$start}
# KNOWN is the list of cases whose failure is the runtime's own, separated by
# commas. Default, on Deno: 7.3.6, where Deno leaves the connection open
# after a close frame that is too long. A plain Deno.serve does the same.
if [ "$runtime" = deno ]; then
  KNOWN=${KNOWN-7.3.6}
else
  KNOWN=${KNOWN-}
fi

mkdir -p "$WORK"
cat > "$WORK/fuzzingclient.json" <<EOF
{
  "outdir": "/reports",
  "servers": [{ "agent": "cho-$runtime", "url": "ws://$HOST:$PORT" }],
  "cases": $CASES,
  "exclude-cases": $EXCLUDE,
  "exclude-agent-cases": {}
}
EOF

cd "$repo"
PORT=$PORT $start &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT

# Wait for the server: it answers a request that is not an upgrade with 426.
tries=0
until curl -s -o /dev/null "http://localhost:$PORT/"; do
  tries=$((tries + 1))
  if [ "$tries" -gt 100 ]; then
    echo "the echo server did not start" >&2
    exit 1
  fi
  sleep 0.2
done

container=""
trap 'kill $server 2>/dev/null || true; docker rm -f "$container" > /dev/null 2>&1 || true' EXIT

# The suite stops, with no error, at the first case it cannot connect for,
# and reports the cases before it. So a stop is found in its log, and is not
# a result: the run is made again, a few times.
#
# With Docker in a virtual machine (Colima, Docker Desktop), a connection
# from a container to the machine times out now and then, for any server.
attempt=0
while :; do
  attempt=$((attempt + 1))
  # The files are copied in and out: no folder of the machine is mounted, so
  # WORK can be anywhere, whatever Docker shares with its containers.
  container=$(docker create \
    --add-host=host.docker.internal:host-gateway \
    crossbario/autobahn-testsuite \
    wstest -m fuzzingclient -s /fuzzingclient.json)
  docker cp "$WORK/fuzzingclient.json" "$container:/fuzzingclient.json"
  docker start -a "$container" > "$WORK/wstest.log" 2>&1 ||
    { cat "$WORK/wstest.log" >&2; exit 1; }
  rm -rf "$WORK/reports"
  docker cp "$container:/reports" "$WORK/reports"
  docker rm -f "$container" > /dev/null
  if ! grep -q "Connection to .* failed" "$WORK/wstest.log"; then
    break
  fi
  echo "attempt $attempt stopped: the suite could not connect to the server" >&2
  grep "Running test case" "$WORK/wstest.log" | tail -1 >&2
  # A server that a case left hanging is a failure, not a network that
  # dropped a connection: it must still answer.
  status=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || true)
  if [ "$status" != "426" ]; then
    echo "the server no longer answers (${status:-nothing}): this is a failure" >&2
    exit 1
  fi
  if [ "$attempt" -ge 5 ]; then
    echo "the suite could not finish in $attempt attempts" >&2
    exit 1
  fi
done

echo "report: $WORK/reports/index.html"
node "$here/report.mjs" "$WORK/reports/index.json" "$KNOWN"
