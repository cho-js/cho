/**
 * Tests for `mod.ts`: `KafkaLinker` checks its options, and links an
 * application without connecting to anything.
 *
 * What the adapter does with messages is tested in `consume_test.ts`, and
 * against a broker in `kafka_test.ts`.
 *
 * The adapter supports Node.js only: on the other runtimes the tests are
 * skipped, and the adapter and its client library are not loaded.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { engine } from "@chojs/core/utils";
import { loose } from "@chojs/core/utils/test_utils";
import type { Route } from "@chojs/message/linker";
import type { KafkaLinked as Linked, KafkaLinkerOptions } from "./mod.ts";

/** Whether the adapter runs here. */
const NODE = engine() === "node";

/** `describe`, skipped on a runtime the adapter does not support. */
const suite = NODE ? describe : describe.skip;

// Loaded on Node.js only: the client library reads its files when it loads.
const { Consumer, Producer } = NODE
  ? await import("@platformatic/kafka")
  : loose({});
const { KafkaLinked, KafkaLinker } = NODE
  ? await import("./mod.ts")
  : loose({}) as typeof import("./mod.ts");

/** Options that are right. Nothing listens on the broker. */
const OPTIONS: KafkaLinkerOptions = {
  brokers: ["127.0.0.1:1"],
  groupId: "mailer",
};

/** A route of a topic. */
const route = (topic: string): Route => ({
  topic,
  name: `Test.${topic}`,
  handle: () => Promise.resolve(),
});

/** Close the clients of a linked application that was never started. */
const close = (linked: Linked) => linked.stop();

suite("KafkaLinker options", () => {
  const rejects = (options: unknown, message: RegExp) =>
    assert.throws(() => new KafkaLinker(loose(options)), message);

  it("needs options", () => {
    rejects(undefined, /^TypeError: KafkaLinker: expected options/);
  });

  it("needs brokers", () => {
    const message = /^TypeError: KafkaLinker: the "brokers" option is required/;
    rejects({ groupId: "g" }, message);
    rejects({ brokers: [], groupId: "g" }, message);
    rejects({ brokers: "localhost:9092", groupId: "g" }, message);
    rejects({ brokers: [""], groupId: "g" }, message);
  });

  it("needs a group", () => {
    const message = /^TypeError: KafkaLinker: the "groupId" option is required/;
    rejects({ brokers: ["a:1"] }, message);
    rejects({ brokers: ["a:1"], groupId: "" }, message);
  });

  it("names an unknown option, and the known ones", () => {
    rejects(
      { ...OPTIONS, group: "g" },
      /unknown option "group"\. Known options: brokers, client, clientId, concurrency, consume, deadLetter, from, groupId, onFatal, retries, retryDelay$/,
    );
  });

  it("checks each option", () => {
    rejects({ ...OPTIONS, from: "start" }, /"from" option is "earliest" or/);
    rejects({ ...OPTIONS, retries: -1 }, /"retries" option is 0 or more/);
    rejects({ ...OPTIONS, retries: 1.5 }, /"retries" option is 0 or more/);
    rejects({ ...OPTIONS, concurrency: 0 }, /"concurrency" option is 1 or/);
    rejects({ ...OPTIONS, retryDelay: -5 }, /"retryDelay" option is a number/);
    rejects({ ...OPTIONS, retryDelay: "1s" }, /"retryDelay" option is a/);
    rejects({ ...OPTIONS, deadLetter: "" }, /"deadLetter" option is a topic/);
    rejects({ ...OPTIONS, deadLetter: true }, /"deadLetter" option is a/);
    rejects({ ...OPTIONS, onFatal: "exit" }, /"onFatal" option is a function/);
  });

  it("accepts every option", () => {
    new KafkaLinker({
      ...OPTIONS,
      clientId: "mailer-1",
      from: "earliest",
      retries: 0,
      retryDelay: (retry) => retry * 100,
      deadLetter: "dead",
      concurrency: 4,
      onFatal: () => {},
      client: { connectTimeout: 1000 },
      consume: { sessionTimeout: 10_000 },
    });
  });
});

suite("KafkaLinker.link", () => {
  it("gives the clients, and connects nothing", async () => {
    const linked = new KafkaLinker(OPTIONS).link([route("orders.created")]);
    assert.ok(linked instanceof KafkaLinked);
    assert.ok(linked.instance.consumer instanceof Consumer);
    assert.ok(linked.instance.producer instanceof Producer);
    assert.equal(linked.instance.consumer.groupId, "mailer");
    assert.equal(linked.instance.consumer.isActive(), false);
    await close(linked);
  });

  it("links one application only", async () => {
    const linker = new KafkaLinker(OPTIONS);
    const linked = linker.link([]);
    assert.throws(
      () => linker.link([]),
      /^Error: KafkaLinker\.link\(\) was already called: use one linker for one application$/,
    );
    await close(linked);
  });

  it("refuses a topic longer than Kafka accepts", () => {
    const linker = new KafkaLinker(OPTIONS);
    const topic = "a".repeat(250);
    assert.throws(
      () => linker.link([route(topic)]),
      /the topic of Test\.a+ has 250 characters: Kafka accepts 249/,
    );
    // Nothing was linked: the linker can still be used.
    return close(linker.link([route("a".repeat(249))]));
  });

  it("refuses a dead-letter topic that is the topic itself", () => {
    assert.throws(
      () =>
        new KafkaLinker({ ...OPTIONS, deadLetter: "orders" }).link([
          route("orders"),
        ]),
      /the dead-letter topic of "orders" is "orders" itself/,
    );
    assert.throws(
      () =>
        new KafkaLinker({ ...OPTIONS, deadLetter: (topic) => topic }).link([
          route("orders"),
        ]),
      /the dead-letter topic of "orders" is "orders" itself/,
    );
  });

  it("rejects the start when no broker answers, and still stops", async () => {
    const linked = new KafkaLinker({
      ...OPTIONS,
      client: { connectTimeout: 200, retries: 0 },
    }).link([route("orders")]);
    await assert.rejects(linked.start());
    await linked.stop();
  });

  it("returns the same promise for every start", async () => {
    const linked = new KafkaLinker(OPTIONS).link([]);
    assert.equal(linked.start(), linked.start());
    await linked.start();
    await linked.stop();
  });
});
