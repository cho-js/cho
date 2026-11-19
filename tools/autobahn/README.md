# The Autobahn test suite

[Autobahn](https://github.com/crossbario/autobahn-testsuite) is the usual
conformance check of a WebSocket implementation: a client that sends a server
every kind of frame the protocol (RFC 6455) allows and forbids, and judges what
the server does.

`@chojs/web` speaks the protocol itself on Node.js (`web/ws-protocol.ts`): this
folder checks it. On Deno and on Bun the protocol is the runtime's, and the
suite checks what `@chojs/web` puts around it.

```sh
tools/autobahn/run.sh         # on Node.js
tools/autobahn/run.sh deno
tools/autobahn/run.sh bun
```

It needs Docker, for the suite: the image `crossbario/autobahn-testsuite`. The
echo server, `server.ts`, runs on the machine, and the suite reaches it from its
container. It is run by hand: it is not part of the tests, and not a job of the
CI.

## The result

Run on 2026-11-19, with the cases of compression left out (`12.*` and `13.*`:
the server has no `permessage-deflate`):

| Runtime | Cases | OK  | Non-strict | Informational | Failed |
| ------- | ----- | --- | ---------- | ------------- | ------ |
| Node.js | 301   | 294 | 4          | 3             | 0      |
| Bun     | 301   | 294 | 4          | 3             | 0      |
| Deno    | 301   | 295 | 2          | 3             | 1      |

- **Non-strict** (`6.4.*`): text that is not UTF-8 is refused when its message
  is whole, and not at the first byte that is wrong. The protocol allows both.
- **Informational** (`7.1.6`, `7.13.*`): nothing to judge.
- **The one failure on Deno**, `7.3.6`, is Deno's own: after a close frame that
  is too long, it leaves the connection for the client to close. A plain
  `Deno.serve` with `Deno.upgradeWebSocket` gives the same result. `run.sh`
  knows it (`KNOWN`), and does not fail for it.

## What `run.sh` takes

| Variable  | Default                | What it is                                                  |
| --------- | ---------------------- | ----------------------------------------------------------- |
| `CASES`   | `["*"]`                | the cases to run, as JSON                                   |
| `EXCLUDE` | `["12.*", "13.*"]`     | the cases to leave out, as JSON                             |
| `KNOWN`   | `7.3.6` on Deno        | the cases whose failure is the runtime's own, with commas   |
| `HOST`    | `host.docker.internal` | the name of the machine, seen from a container              |
| `PORT`    | `9001`                 | the port of the echo server                                 |
| `WORK`    | a temporary folder     | where the report is written: `reports/index.html`           |
| `START`   | by the runtime         | the command that starts the server, to compare with another |

## When the suite stops

The suite stops, with no error, at the first case it cannot connect for, and
reports the cases before it as if they were all of them. `run.sh` finds the stop
in the log of the suite, and runs the suite again, five times at most.

With Docker in a virtual machine (Colima, Docker Desktop), a connection from a
container to the machine times out now and then. It happened for every server
that was tried, a plain `Bun.serve` with nothing of CHO included, and also at
the first connection to a server that had just started. A server that no longer
answers a request from the machine is another matter: `run.sh` fails for it.
