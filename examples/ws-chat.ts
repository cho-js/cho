#!/usr/bin/env -S deno run --allow-all
/**
 * A chat over WebSockets, with `@Ws`: rooms, and a page that connects to one.
 *
 * - `GET /chat/:room` upgrades the request to a WebSocket. The name of the
 *   user is in the query string, and a name that is taken refuses the
 *   connection, with `409`, before any socket opens.
 * - What a method returns is sent on the socket: `join` sends who is in the
 *   room, and `message` answers the sender.
 * - A message is sent to the others of the room with `socket.send`.
 *
 * The same file runs on Deno, Bun and Node.js: `serve` upgrades the
 * connection with what each runtime has.
 *
 * ```sh
 * deno run --allow-net --allow-env examples/ws-chat.ts
 * bun examples/ws-chat.ts
 * npx tsx examples/ws-chat.ts
 * ```
 *
 * Run it, and open http://localhost:8082 in two windows.
 *
 * @module
 */
import {
  Args,
  ChoWeb,
  type ChoWebContext,
  type ChoWebSocket,
  Controller,
  Get,
  HttpError,
  Injectable,
  Module,
  Param,
  Query,
  Ws,
  WsClose,
  WsMessage,
  WsOpen,
} from "@chojs/web";
import { serve } from "@chojs/web/serve";

/** The rooms, and who is in each: the name of a user, and its socket. */
@Injectable()
export class Rooms {
  readonly #rooms = new Map<string, Map<string, ChoWebSocket>>();

  /** The users of a room, by name. */
  of(room: string): Map<string, ChoWebSocket> {
    let users = this.#rooms.get(room);
    if (!users) {
      this.#rooms.set(room, users = new Map());
    }
    return users;
  }

  /** Send to every user of a room, except one. */
  send(room: string, message: unknown, except?: ChoWebSocket): void {
    for (const socket of this.of(room).values()) {
      if (socket !== except) {
        socket.send(message);
      }
    }
  }
}

@Controller({ route: "chat", dependencies: [Rooms] })
export class ChatController {
  constructor(readonly rooms: Rooms) {}

  /**
   * The request that is upgraded. It is an ordinary handler: it has `@Args`,
   * and it refuses the connection by throwing, before there is a socket.
   */
  @Ws(":room")
  @Args(Param("room"), Query("name"))
  join(room: string, name: string | undefined, ctx: ChoWebContext) {
    if (!name) {
      throw new HttpError(400, "a name is needed: ?name=ada");
    }
    if (this.rooms.of(room).has(name)) {
      throw new HttpError(409, `${name} is already in ${room}`);
    }
    // The data of a connection is in the state of its request.
    ctx.state.set("name", name);
    // The first message of the socket.
    return { type: "joined", room, users: [...this.rooms.of(room).keys()] };
  }

  @WsOpen()
  open(socket: ChoWebSocket) {
    const { room, name } = who(socket);
    this.rooms.of(room).set(name, socket);
    this.rooms.send(room, { type: "arrived", name }, socket);
  }

  @WsMessage()
  message(data: string | Uint8Array, socket: ChoWebSocket) {
    const { room, name } = who(socket);
    if (typeof data !== "string") {
      socket.close(1003, "this chat is text only");
      return;
    }
    this.rooms.send(room, { type: "said", name, text: data }, socket);
    // Sent back to who wrote.
    return { type: "sent", text: data };
  }

  @WsClose()
  close(_code: number, _reason: string, socket: ChoWebSocket) {
    const { room, name } = who(socket);
    this.rooms.of(room).delete(name);
    this.rooms.send(room, { type: "left", name });
  }
}

/** The room and the name of a socket: from the request it came from. */
function who(socket: ChoWebSocket): { room: string; name: string } {
  return {
    room: socket.ctx.params.room!,
    name: socket.ctx.state.get("name") as string,
  };
}

@Controller()
export class PageController {
  @Get("")
  page() {
    return new Response(PAGE, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

@Module({ controllers: [ChatController, PageController], providers: [Rooms] })
export class AppModule {}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>CHO: a chat over WebSockets</title>
<style>
  body { font: 16px system-ui; max-width: 40rem; margin: 2rem auto; }
  #log { border: 1px solid #ccc; height: 16rem; overflow: auto; padding: .5rem; }
  input { font: inherit; padding: .25rem; }
</style>
<h1>Room <code>lobby</code></h1>
<form id="join">
  <input name="name" placeholder="your name" required>
  <button>Join</button>
</form>
<div id="log"></div>
<form id="say" hidden>
  <input name="text" placeholder="say something" autocomplete="off" required>
  <button>Send</button>
</form>
<script type="module">
  const log = document.querySelector("#log");
  const write = (line) => {
    log.append(Object.assign(document.createElement("div"), { textContent: line }));
    log.scrollTop = log.scrollHeight;
  };
  let socket;
  document.querySelector("#join").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = encodeURIComponent(event.target.name.value);
    socket = new WebSocket("ws://" + location.host + "/chat/lobby?name=" + name);
    socket.addEventListener("open", () => {
      document.querySelector("#join").hidden = true;
      document.querySelector("#say").hidden = false;
    });
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "joined") write("you joined; here: " + (event.users.join(", ") || "nobody yet"));
      if (event.type === "arrived") write(event.name + " arrived");
      if (event.type === "left") write(event.name + " left");
      if (event.type === "said") write(event.name + ": " + event.text);
      if (event.type === "sent") write("you: " + event.text);
    });
    // A refusal (a name that is taken) is a close with no open.
    socket.addEventListener("close", (close) => write("closed (" + close.code + ")"));
  });
  document.querySelector("#say").addEventListener("submit", (event) => {
    event.preventDefault();
    socket.send(event.target.text.value);
    event.target.reset();
  });
</script>
`;

// The built-in router, served by the runtime the example runs on. `serve`
// takes the application, so that it can upgrade its connections.
const app = await ChoWeb.create(AppModule);
const server = await serve(app, { port: 8082, closeTimeout: 2000 });
console.log(`open http://localhost:${server.port}`);

// Ctrl+C: closing the server closes the sockets with the code 1001.
process.once("SIGINT", async () => {
  await server.close();
  await app.close();
  process.exit(0);
});
