/**
 * Tests for `sse.ts`: the format of a server-sent event, and the body of an
 * event stream.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capture } from "@chojs/core/utils/test_utils";
import { format_event, is_async_iterable, sse_response } from "./sse.ts";

const NAME = "Feed.events";

/** The text of an event. */
const format = (value: unknown) => format_event(value, NAME);

/** A promise, with the functions that settle it. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}

/** Wait for a number of milliseconds. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The response of an iterable, and the errors it was cut with. */
function stream(source: AsyncIterable<unknown>, keepAlive?: number) {
  const reported: unknown[] = [];
  const response = sse_response(source, {
    name: NAME,
    keepAlive,
    failed: (error) => void reported.push(error),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  /** Read the next chunk, as text; `undefined` at the end. */
  const read = async () => {
    const { done, value } = await reader.read();
    return done ? undefined : decoder.decode(value);
  };
  return { response, reader, read, reported };
}

describe("format_event", () => {
  it("writes a string as the data of an event", () => {
    assert.equal(format("hello"), "data: hello\n\n");
    assert.equal(format({ data: "hello" }), "data: hello\n\n");
    assert.equal(format(""), "data: \n\n");
  });

  it("writes one data line for each line of a string", () => {
    assert.equal(
      format("one\ntwo\r\nthree\rfour"),
      "data: one\ndata: two\ndata: three\ndata: four\n\n",
    );
    // a leading space is the client's to strip once: it is kept
    assert.equal(format(" padded"), "data:  padded\n\n");
  });

  it("writes any other data as JSON, on one line", () => {
    assert.equal(
      format({ data: { n: 1, text: "a\nb" } }),
      'data: {"n":1,"text":"a\\nb"}\n\n',
    );
    assert.equal(format({ data: [1, 2] }), "data: [1,2]\n\n");
    assert.equal(format({ data: 42 }), "data: 42\n\n");
    assert.equal(format({ data: null }), "data: null\n\n");
    assert.equal(format({ data: false }), "data: false\n\n");
  });

  it("writes the name, the id and the retry delay before the data", () => {
    assert.equal(
      format({ event: "tick", id: "7", retry: 5000, data: "now" }),
      "event: tick\nid: 7\nretry: 5000\ndata: now\n\n",
    );
    assert.equal(format({ retry: 0, data: "x" }), "retry: 0\ndata: x\n\n");
    assert.equal(format({ id: "", data: "x" }), "id: \ndata: x\n\n");
  });

  it("rejects what is not an event", () => {
    for (
      const [value, got] of [
        [42, "42"],
        [null, "null"],
        [undefined, "undefined"],
        [{}, "[object Object]"],
        [{ event: "tick" }, "[object Object]"],
        [{ data: undefined }, "[object Object]"],
        [[], ""],
      ] as const
    ) {
      assert.throws(() => format(value), {
        code: "CHO_WEB_INVALID_EVENT",
        message:
          `@Sse() handler Feed.events: an event must be a string or an object with data, got ${got}`,
      });
    }
  });

  it("rejects a name or an id that does not fit on a line", () => {
    assert.throws(() => format({ event: "a\nb", data: "x" }), {
      code: "CHO_WEB_INVALID_EVENT",
      message:
        '@Sse() handler Feed.events: "event" must be a string with no line break, got "a\\nb"',
    });
    assert.throws(() => format({ event: 1, data: "x" }), {
      code: "CHO_WEB_INVALID_EVENT",
      message:
        '@Sse() handler Feed.events: "event" must be a string with no line break, got 1',
    });
    for (const id of ["a\rb", "a\0b", 7]) {
      assert.throws(() => format({ id, data: "x" }), {
        code: "CHO_WEB_INVALID_EVENT",
        message: /^@Sse\(\) handler Feed\.events: "id" must be a string/,
      });
    }
  });

  it("rejects a retry delay that is not a whole number", () => {
    for (const retry of [1.5, -1, "1000", NaN]) {
      assert.throws(() => format({ retry, data: "x" }), {
        code: "CHO_WEB_INVALID_EVENT",
        message:
          /^@Sse\(\) handler Feed\.events: "retry" must be a whole number of milliseconds, got /,
      });
    }
  });

  it("rejects data that cannot be serialized as JSON", () => {
    assert.throws(() => format({ data: 1n }), { name: "TypeError" });
    assert.throws(() => format({ data: () => {} }), {
      code: "CHO_WEB_INVALID_EVENT",
      message: /^@Sse\(\) handler Feed\.events: "data" cannot be serialized/,
    });
  });
});

describe("is_async_iterable", () => {
  it("tells an async iterable from anything else", () => {
    assert.equal(is_async_iterable((async function* () {})()), true);
    assert.equal(
      is_async_iterable({ [Symbol.asyncIterator]: () => ({}) }),
      true,
    );
    for (const value of [undefined, null, "text", [1], { data: 1 }, 42]) {
      assert.equal(is_async_iterable(value), false);
    }
  });
});

describe("sse_response", () => {
  it("answers 200, with the headers of an event stream", async () => {
    const { response, reader } = stream((async function* () {})());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(
      response.headers.get("cache-control"),
      "no-cache, no-transform",
    );
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    await reader.cancel();
  });

  it("sends each event, then ends with the iteration", async () => {
    const { read, reported } = stream((async function* () {
      yield "one";
      yield { event: "two", data: { n: 2 } };
    })());
    assert.equal(await read(), "data: one\n\n");
    assert.equal(await read(), 'event: two\ndata: {"n":2}\n\n');
    assert.equal(await read(), undefined);
    assert.deepEqual(reported, []);
  });

  it("reads nothing before the body is read, and one event for each read", async () => {
    let started = 0;
    let yielded = 0;
    const { read, reader } = stream((async function* () {
      started++;
      while (true) {
        yielded++;
        yield "tick";
      }
    })());
    await sleep(10);
    assert.equal(started, 0);

    await read();
    await sleep(10);
    assert.equal(yielded, 1);
    await read();
    await sleep(10);
    assert.equal(yielded, 2);
    await reader.cancel();
  });

  it("ends the iteration when the body is cancelled", async () => {
    const ended = deferred();
    const { read, reader, reported } = stream((async function* () {
      try {
        while (true) {
          yield "tick";
        }
      } finally {
        ended.resolve();
      }
    })());
    await read();
    await reader.cancel();
    await ended.promise;
    assert.deepEqual(reported, []);
  });

  it("is cancelled at once, even when the iteration is waiting", async () => {
    const release = deferred();
    const ended = deferred();
    const { read, reader } = stream((async function* () {
      try {
        yield "first";
        await release.promise;
        yield "never sent";
      } finally {
        ended.resolve();
      }
    })());
    await read();
    const pending = read();
    await sleep(10);
    await reader.cancel(); // does not wait for the iteration
    assert.equal(await pending, undefined);
    release.resolve();
    await ended.promise;
  });

  it("ends an iterable that was never read, when the body is cancelled", async () => {
    let returned = 0;
    const source = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: false, value: "tick" }),
        return: () => {
          returned++;
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    };
    const { reader } = stream(source);
    await reader.cancel();
    await sleep(0);
    assert.equal(returned, 1);
  });

  it("fails the body with what the iteration throws, and tells of it once", async () => {
    const failure = new Error("db down");
    const { read, reported } = stream((async function* () {
      yield "one";
      throw failure;
    })());
    assert.equal(await read(), "data: one\n\n");
    await assert.rejects(read(), failure);
    assert.deepEqual(reported, [failure]);
  });

  it("fails the body on something that is not an event, and ends the iteration", async () => {
    const ended = deferred();
    const { read, reported } = stream((async function* () {
      try {
        yield "one";
        yield 42;
        yield "never sent";
      } finally {
        ended.resolve();
      }
    })());
    await read();
    await assert.rejects(read(), {
      code: "CHO_WEB_INVALID_EVENT",
      message:
        "@Sse() handler Feed.events: an event must be a string or an object with data, got 42",
    });
    await ended.promise;
    assert.equal(reported.length, 1);
  });

  it("fails the body with what the iterable throws when it is opened", async () => {
    const failure = new Error("no source");
    const { read, reported } = stream({
      [Symbol.asyncIterator]() {
        throw failure;
      },
    });
    await assert.rejects(read(), failure);
    assert.deepEqual(reported, [failure]);
  });

  it("sends a comment when nothing is sent for the keep-alive delay", async () => {
    const release = deferred();
    const { read, reader } = stream(
      (async function* () {
        yield "first";
        await release.promise;
        yield "second";
      })(),
      20,
    );
    assert.equal(await read(), "data: first\n\n");
    assert.equal(await read(), ":\n\n");
    assert.equal(await read(), ":\n\n");
    release.resolve();
    assert.equal(await read(), "data: second\n\n");
    // No timer is left: the test runner would not exit.
    await reader.cancel();
  });

  it("starts no keep-alive timer for a body that is never read", async () => {
    const { response } = stream((async function* () {})(), 5);
    await sleep(30);
    assert.equal(response.bodyUsed, false);
  });

  it("stops the keep-alive when the iteration ends or fails", async () => {
    const ended = stream(
      (async function* () {
        yield "only";
      })(),
      5,
    );
    await ended.read();
    assert.equal(await ended.read(), undefined);

    const failed = stream(
      (async function* () {
        yield "only";
        throw new Error("failed");
      })(),
      5,
    );
    await failed.read();
    await assert.rejects(failed.read(), { message: "failed" });
    await sleep(20);
  });
});

describe("sse_response, what is logged", () => {
  /** Read every chunk of a response, until it ends or fails. */
  async function drain(response: Response) {
    const reader = response.body!.getReader();
    try {
      while (!(await reader.read()).done);
    } catch (error) {
      return error;
    }
  }

  it("leaves the error that cuts the stream to the server: it logs nothing", async () => {
    const failure = new Error("db down");
    const { result, output } = await capture(() =>
      drain(sse_response(
        (async function* () {
          yield "one";
          throw failure;
        })(),
        { name: NAME },
      ))
    );
    assert.equal(result, failure); // the body fails: the server reports it
    assert.deepEqual(output.error, []);
  });

  it("logs what the end of the iteration throws, once the body is cancelled", async () => {
    const failure = new Error("cleanup failed");
    const { output } = await capture(async () => {
      const reader = sse_response(
        (async function* () {
          try {
            yield "one";
            yield "two";
          } finally {
            // deno-lint-ignore no-unsafe-finally
            throw failure;
          }
        })(),
        { name: NAME },
      ).body!.getReader();
      await reader.read();
      await reader.cancel();
      await sleep(10);
    });
    assert.deepEqual(output.error, [failure]);
  });
});
