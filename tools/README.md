# Tools

What the repository uses to test CHO outside of a test runner: against real
brokers, in a real terminal, in the runtime of Cloudflare Workers, and against a
conformance suite. Nothing here is a package, and nothing here is published.

| Tool                       | What it does                                                     | Needs           | Run by         |
| -------------------------- | ---------------------------------------------------------------- | --------------- | -------------- |
| [`brokers.sh`](#brokerssh) | Starts the NATS and Kafka brokers the adapter tests run against  | Docker          | the CI, or you |
| [`pty.sh`](#ptysh)         | Asks the questions of `cho new` in a real terminal               | `script(1)`     | the CI, or you |
| [`workerd/`](./workerd)    | Runs the tests in workerd, the runtime of Cloudflare Workers     | Docker, or Node | the CI, or you |
| [`autobahn/`](./autobahn)  | Runs the Autobahn conformance suite against the WebSocket server | Docker          | you            |

Each folder has a README of its own. `brokers.sh` and `pty.sh` are one file
each: they are described here.

## `brokers.sh`

The tests of `@chojs/vendor-nats` and `@chojs/vendor-kafka` have two parts. One
runs with a connection made by hand, on every test run. The other runs against a
real broker, and is skipped when the address of the broker is not in the
environment. `brokers.sh` starts those brokers in Docker, and waits until they
answer.

```sh
tools/brokers.sh start          # both brokers
tools/brokers.sh start nats     # one of them: nats, or kafka
tools/brokers.sh stop           # stop what is running
```

Then run the tests with the addresses in the environment:

```sh
NATS_URL=localhost:4222 KAFKA_BROKERS=localhost:9092 deno task test
```

Without a variable, the tests that need its broker are skipped, and the others
run as always.

### What it starts

| Broker | Container   | Image                | Port   | Variable of the tests          |
| ------ | ----------- | -------------------- | ------ | ------------------------------ |
| NATS   | `cho-nats`  | `nats:2`             | `4222` | `NATS_URL=localhost:4222`      |
| Kafka  | `cho-kafka` | `apache/kafka:4.1.0` | `9092` | `KAFKA_BROKERS=localhost:9092` |

- **NATS runs with JetStream** (`-js`): the tests of the durable consumers need
  it.
- **Kafka is one broker**, with the settings of its image, and no setup.
- **A container is removed when it stops** (`--rm`): nothing of a run is kept,
  so each start is a broker with no topic and no stream.
- `start` returns when the log of each broker says it is ready. A broker that
  does not say so in 90 seconds fails the script, which prints the end of its
  log.
- `stop` stops both, and does not fail when one is not running.

### In the CI

The workflow (`.github/workflows/ci.yml`) starts NATS for the Deno, Node.js and
Bun jobs, so the tests of the NATS adapter run against a real server on the
three runtimes. Kafka takes longer to start, and its client library is written
for Node.js: it has a job of its own, on Node.js.

### On a Mac

Docker needs a virtual machine there, such as Colima or Docker Desktop. Start it
before the script. Both brokers publish their port on `localhost`, so the tests
reach them from the machine as they do in the CI.

## `pty.sh`

The tests of `@chojs/prompt` and of `cho new` ask their questions on a scripted
terminal. `pty.sh` asks them on a pseudo-terminal, made by `script(1)`: the keys
are bytes on a real input, in raw mode, read by the `node:readline` of the
runtime.

```sh
tools/pty.sh              # Deno, Node.js and Bun
tools/pty.sh deno node    # these runtimes only
```

For each runtime it runs:

- **`examples/prompt.ts`**, twice: every question to its answer, and once
  cancelled with Ctrl+C.
- **`cho new`**, which asks with the same questions, and checks the workspace it
  wrote. On Node.js it is the npm package of the tool that runs, the file
  `npm install --global @chojs/cli` installs: the script builds it first
  (`deno task --cwd cli npm`), so Deno is needed there too.

Each key is sent when the question it answers is on the screen, not after a
fixed time, so a slow start does not fail the run. The script works with the
`script` of Linux and with the one of macOS.

### In the CI

The Deno, Node.js and Bun jobs each run it for their runtime, after the tests.
