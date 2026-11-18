/**
 * Server-sent events: what turns the events an `@Sse` handler returns into a
 * `text/event-stream` response. Internal to `@chojs/web`: the route compiler
 * calls {@link sse_response} (see `routes.ts`); it is not a package export.
 *
 * The format is the one of the HTML standard
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html): an event
 * is a block of `field: value` lines, ended by an empty line.
 *
 * @module
 */

import { web_error } from "./errors.ts";
import { describe } from "@chojs/core/utils";

/** The headers of an event stream. */
const HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream",
  // Nothing on the way keeps the events, or rewrites them (compression).
  "cache-control": "no-cache, no-transform",
  // Not a standard header: nginx reads it. As a reverse proxy it collects a
  // response before it passes it on, so events would arrive late and in
  // batches; `no` turns that off for this response. Others ignore it.
  "x-accel-buffering": "no",
};

/** A comment, which clients ignore: what keeps an idle connection open. */
const KEEP_ALIVE = ":\n\n";

/** What ends a line of an event stream. */
const LINE_BREAK = /\r\n|\r|\n/;

/** What {@link sse_response} needs besides the events. */
export type SseStreamOptions = {
  /** The handler, `Controller.method`, for the error messages. */
  readonly name: string;
  /**
   * Send a comment whenever this many milliseconds pass with nothing sent.
   * Default: none.
   */
  readonly keepAlive?: number | undefined;
  /**
   * Called with the error that cuts the stream, just before it is cut: what
   * the iteration threw, or the error of something that is not an event. It
   * is there for the debug log; the error itself is the server's to report,
   * since it gets a body that fails. Default: none.
   */
  readonly failed?: ((error: unknown) => void) | undefined;
};

/**
 * Whether a value is an async iterable: what an `async *` function returns.
 *
 * @param value Any value.
 */
export function is_async_iterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[
        Symbol.asyncIterator
      ] === "function";
}

/**
 * A field of an event that must fit on one line.
 *
 * @param field The name of the field.
 * @param value Its value.
 * @param name The handler, for the error message.
 * @returns The line of the field.
 * @throws {ChoError} When the value is not a string, or has a line break (or
 *   a NUL, which makes a client ignore an `id`).
 */
function single_line(field: "event" | "id", value: unknown, name: string) {
  if (
    typeof value !== "string" || LINE_BREAK.test(value) ||
    (field === "id" && value.includes("\0"))
  ) {
    throw web_error(
      "CHO_WEB_INVALID_EVENT",
      `@Sse() handler ${name}: ${
        JSON.stringify(field)
      } must be a string with no line break, got ${describe(value)}`,
    );
  }
  return `${field}: ${value}\n`;
}

/**
 * Write one event in the format of an event stream.
 *
 * - A string is the event `{ data: string }`.
 * - `data` is required. A string is sent as it is, one `data:` line for each
 *   of its lines; anything else is sent as JSON, on one line.
 * - `event`, `id` and `retry` are optional.
 *
 * @param value What the handler yielded.
 * @param name The handler, `Controller.method`, for the error messages.
 * @returns The text of the event, with the empty line that ends it.
 * @throws {ChoError} When the value is not an event, when a field is
 *   invalid, or when the data cannot be serialized as JSON.
 *
 * @example
 * ```ts
 * format_event("hello", "Feed.events"); // "data: hello\n\n"
 * format_event({ event: "tick", id: "2", data: { n: 2 } }, "Feed.events");
 * // 'event: tick\nid: 2\ndata: {"n":2}\n\n'
 * ```
 */
export function format_event(value: unknown, name: string): string {
  const event = typeof value === "string" ? { data: value } : value;
  if (
    typeof event !== "object" || event === null ||
    (event as { data?: unknown }).data === undefined
  ) {
    throw web_error(
      "CHO_WEB_INVALID_EVENT",
      `@Sse() handler ${name}: an event must be a string or an object with data, got ${
        describe(value)
      }`,
    );
  }
  const { data, event: type, id, retry } = event as Record<string, unknown>;
  let text = "";
  if (type !== undefined) {
    text += single_line("event", type, name);
  }
  if (id !== undefined) {
    text += single_line("id", id, name);
  }
  if (retry !== undefined) {
    if (!(Number.isInteger(retry) && (retry as number) >= 0)) {
      throw web_error(
        "CHO_WEB_INVALID_EVENT",
        `@Sse() handler ${name}: "retry" must be a whole number of milliseconds, got ${
          describe(retry)
        }`,
      );
    }
    text += `retry: ${retry}\n`;
  }
  let lines: string[];
  if (typeof data === "string") {
    lines = data.split(LINE_BREAK);
  } else {
    // JSON has no line break of its own: it is one line.
    const json = JSON.stringify(data) as string | undefined;
    if (json === undefined) { // a function, a symbol
      throw web_error(
        "CHO_WEB_INVALID_EVENT",
        `@Sse() handler ${name}: "data" cannot be serialized as JSON, got ${
          describe(data)
        }`,
      );
    }
    lines = [json];
  }
  for (const line of lines) {
    text += `data: ${line}\n`;
  }
  return `${text}\n`;
}

/**
 * Make the response of an event stream: a `200` of `text/event-stream` whose
 * body sends the events of an async iterable, as they come.
 *
 * - Nothing is read before the body is: the iterator is taken on the first
 *   read, and each read takes one event. A slow client slows the iteration
 *   down, and a body that is never read (a `HEAD` request) starts nothing.
 * - When the iteration ends, the body ends.
 * - When the body is cancelled (the client went away), the iteration is ended:
 *   `return()` is called on the iterator. It is not waited for, since an
 *   `async *` function that is waiting only ends once what it awaits settles.
 *   What it throws is logged with `console.error`: no one else would see it.
 * - When the iteration throws, or gives something that is not an event, the
 *   iteration is ended and the body fails with the error: the server cuts the
 *   connection, and reports the error its own way. The status is already
 *   sent, so the error handlers of the route have nothing to answer: they are
 *   not called.
 * - With `keepAlive`, a comment is sent whenever that long passes with nothing
 *   sent, once the body is being read.
 *
 * @param source The events: what the handler returned.
 * @param options The name of the handler, the keep-alive delay, and a
 *   function that is told of the error that cuts the stream.
 * @returns The response.
 */
export function sse_response(
  source: AsyncIterable<unknown>,
  options: SseStreamOptions,
): Response {
  const { name, keepAlive, failed } = options;
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<unknown> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let over = false;

  /** Stop for good: nothing more is sent, and no timer is left. */
  function stop(): void {
    over = true;
    clearTimeout(timer);
  }

  /** (Re)start the keep-alive timer: something was just sent. */
  function alive(controller: ReadableStreamDefaultController<Uint8Array>) {
    if (keepAlive === undefined) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (over) {
        return;
      }
      // Not piled up for a client that does not read.
      if ((controller.desiredSize ?? 0) >= 0) {
        controller.enqueue(encoder.encode(KEEP_ALIVE));
      }
      alive(controller);
    }, keepAlive);
  }

  /**
   * End the iteration, when it can be: what it throws is logged.
   *
   * @param unread Whether to end an iterable that was never read too, so
   *   that it releases what it holds.
   */
  async function end_iteration(unread: boolean): Promise<void> {
    try {
      if (unread) {
        iterator ??= source[Symbol.asyncIterator]();
      }
      await iterator?.return?.();
    } catch (error) {
      // The response is over: there is no body left to fail with it.
      console.error(error);
    }
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (iterator === undefined) {
          iterator = source[Symbol.asyncIterator]();
          alive(controller);
        }
        const result = await iterator.next();
        if (over) {
          return; // cancelled while waiting for the event
        }
        if (result.done) {
          stop();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(format_event(result.value, name)));
        alive(controller);
      } catch (error) {
        if (over) {
          return;
        }
        stop();
        // Not waited for: a waiting `async *` function ends when it can.
        void end_iteration(false);
        failed?.(error);
        // The server sees the body fail, and reports it its own way.
        controller.error(error);
      }
    },
    cancel() {
      stop();
      void end_iteration(true);
    },
    // No event is read ahead of the client.
  }, { highWaterMark: 0 });

  return new Response(body, { headers: HEADERS });
}
