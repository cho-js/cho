#!/bin/sh
# Starts the brokers the tests of the adapters run against, in Docker, and
# waits until they answer. The CI runs it, and so can you:
#
#   tools/brokers.sh start          both brokers
#   tools/brokers.sh start nats     one of them: nats, or kafka
#   NATS_URL=localhost:4222 KAFKA_BROKERS=localhost:9092 deno task test
#   tools/brokers.sh stop
#
# NATS runs with JetStream (-js). Kafka is one broker, with no setup.
set -eu

# start_one <name> <what its log says when it is ready> <docker run arguments>
start_one() {
  name=$1
  ready=$2
  shift 2
  docker run -d --rm --name "$name" "$@" > /dev/null
  i=0
  until docker logs "$name" 2>&1 | grep -q "$ready"; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      echo "$name did not start:" >&2
      docker logs "$name" 2>&1 | tail -20 >&2
      exit 1
    fi
    sleep 1
  done
  echo "$name is ready"
}

case "${1:-start}" in
  start)
    which=${2:-all}
    case "$which" in nats | kafka | all) ;; *)
      echo "usage: tools/brokers.sh start [nats|kafka]" >&2
      exit 2
      ;;
    esac
    if [ "$which" != kafka ]; then
      start_one cho-nats "Server is ready" -p 4222:4222 nats:2 -js
    fi
    if [ "$which" != nats ]; then
      start_one cho-kafka "Kafka Server started" -p 9092:9092 apache/kafka:4.1.0
    fi
    ;;
  stop)
    docker stop cho-nats cho-kafka > /dev/null 2>&1 || true
    ;;
  *)
    echo "usage: tools/brokers.sh start [nats|kafka] | stop" >&2
    exit 2
    ;;
esac
