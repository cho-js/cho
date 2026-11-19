/**
 * The echo server the Autobahn test suite talks to: a `@chojs/web`
 * application that sends every message of a socket back, served by `serve`.
 *
 * It is run by `tools/autobahn/run.sh`, on the runtime that script is given.
 * On Node.js it checks the protocol of `web/ws-protocol.ts`; on Deno and on
 * Bun, the protocol is the runtime's, and it checks what is around it.
 *
 * `PORT` is the port to listen on. Default: `9001`.
 */
import { ChoWeb, Controller, Module, Ws, WsMessage } from "@chojs/web";
import { serve } from "@chojs/web/serve";

@Controller()
class Echo {
  @Ws()
  upgrade() {}

  // A string is sent back as text, and bytes as a binary message.
  @WsMessage()
  message(data: string | Uint8Array) {
    return data;
  }
}

@Module({ controllers: [Echo] })
class App {}

const app = await ChoWeb.create(App);
const server = await serve(app, {
  port: Number(process.env.PORT ?? 9001),
  // The suite sends messages of 16 MiB.
  maxPayload: 32 * 1024 * 1024,
});
console.log(`echo server on ${server.runtime}, port ${server.port}`);
