#!/usr/bin/env -S deno run --allow-all
/**
 * Server-sent events with `@Sse`: two streams, and a page that reads them.
 *
 * - `GET /clock/ticks` sends the time every second, for as long as the client
 *   listens. The page reads it with `EventSource`.
 * - `POST /chat/answers` answers a question word by word, then ends. It has a
 *   body, so the page reads it with `fetch`.
 *
 * Run it, and open http://localhost:8082
 *
 * @module
 */
import {
  Args,
  Body,
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  Sse,
} from "@chojs/web";
import { serve } from "@chojs/web/serve";

/** Wait, and stop waiting as soon as the client goes away. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

@Controller({ route: "clock" })
export class ClockController {
  /** How many clients are listening now. */
  #listeners = 0;

  // GET /clock/ticks
  // An `async *` method: every `yield` is an event. A comment is sent after
  // 15 seconds of silence, so that a proxy does not close the connection.
  @Sse("ticks", { keepAlive: 15_000 })
  @Args(Header("last-event-id"))
  async *ticks(last: string | undefined, ctx: ChoWebContext) {
    // A client that reconnects says which event it got last: go on from it.
    let tick = Number(last ?? 0);
    this.#listeners++;
    try {
      yield { event: "hello", data: `${this.#listeners} listening` };
      // The server aborts the signal when the client goes away.
      while (!ctx.req.signal.aborted) {
        tick++;
        yield {
          event: "tick",
          id: String(tick),
          data: { tick, time: new Date().toLocaleTimeString() }, // sent as JSON
        };
        await sleep(1000, ctx.req.signal);
      }
    } finally {
      // Runs when the client goes away, too.
      this.#listeners--;
    }
  }
}

/** Stands for a model that answers slowly. */
@Injectable()
export class Model {
  async *answer(question: string, signal: AbortSignal): AsyncGenerator<string> {
    const answer =
      `You asked "${question}". A stream sends each word as soon as it is ready.`;
    for (const word of answer.split(" ")) {
      await sleep(150, signal);
      yield word;
    }
  }
}

@Controller({ route: "chat", dependencies: [Model] })
export class ChatController {
  constructor(readonly model: Model) {}

  // POST /chat/answers
  // A plain method: it can refuse the request before the stream starts, by
  // returning a Response. Otherwise it returns the events.
  @Sse("answers", { method: "POST" })
  @Args(Body<{ question?: string }>())
  answer(body: { question?: string } | undefined, ctx: ChoWebContext) {
    const question = body?.question?.trim();
    if (!question) {
      return Response.json({ error: "ask a question" }, { status: 400 });
    }
    return this.words(question, ctx.req.signal);
  }

  /** The events of an answer: a word each, then a last event. */
  async *words(question: string, signal: AbortSignal) {
    for await (const word of this.model.answer(question, signal)) {
      yield word; // a string is the event { data: word }
    }
    yield { event: "done", data: "" };
  }
}

@Controller({ route: "" })
export class PageController {
  // GET /
  @Get("")
  page() {
    return new Response(PAGE, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

@Module({
  providers: [Model],
  controllers: [PageController, ClockController, ChatController],
})
export class AppModule {}

/** The page: it listens to the clock, and asks questions. */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>CHO: server-sent events</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  output { display: block; min-height: 1.5em; padding: .5rem; background: #f3f3f3; border-radius: .25rem; }
</style>

<h1>Server-sent events</h1>

<h2>GET /clock/ticks, with EventSource</h2>
<output id="clock">connecting…</output>

<h2>POST /chat/answers, with fetch</h2>
<form id="chat">
  <input name="question" value="What is a stream?" size="30">
  <button>Ask</button>
</form>
<output id="answer"></output>

<script type="module">
  // EventSource reconnects by itself, and sends the id of the last event.
  const clock = document.querySelector("#clock");
  const source = new EventSource("/clock/ticks");
  source.addEventListener("hello", (event) => clock.textContent = event.data);
  source.addEventListener("tick", (event) => {
    const { tick, time } = JSON.parse(event.data);
    clock.textContent = "tick " + tick + " at " + time;
  });

  // EventSource only sends GET requests: a POST stream is read with fetch.
  const answer = document.querySelector("#answer");
  document.querySelector("#chat").addEventListener("submit", async (event) => {
    event.preventDefault();
    answer.textContent = "";
    const response = await fetch("/chat/answers", {
      method: "POST",
      body: JSON.stringify({ question: event.target.question.value }),
    });
    if (!response.ok) {
      answer.textContent = (await response.json()).error;
      return;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
      // An event ends with an empty line.
      const events = text.split("\\n\\n");
      text = events.pop();
      for (const lines of events) {
        if (lines.startsWith("data: ")) {
          answer.textContent += lines.slice("data: ".length) + " ";
        }
      }
    }
  });
</script>
`;

// The built-in router, served by the runtime the example runs on.
const app = await ChoWeb.create(AppModule);
// Closing a server waits for its requests, and the clock never ends: after 2
// seconds, what is still open is cut.
const server = await serve(app.handler, { port: 8082, closeTimeout: 2000 });
console.log(`open http://localhost:${server.port}`);

// Ctrl+C: close the server, then release the application.
process.once("SIGINT", async () => {
  await server.close();
  await app.close();
  process.exit(0);
});
