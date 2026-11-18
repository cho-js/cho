/**
 * Tests for `mod.ts`: `KafkaLinker` checks its options, and links an
 * application without connecting to anything.
 *
 * What the adapter does with messages is tested in `consume_test.ts`, and
 * against a broker in `kafka_test.ts`.
 *
 * They need no broker, and run on Node.js, Deno and Bun: the client library
 * is written for Node.js, and the adapter is tested on the other two too. The
 * client library reads a file when it loads, so on Deno they need
 * `--allow-read`, and are skipped without it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import type { Route } from "@chojs/message/linker";
import type { KafkaLinked as Linked, KafkaLinkerOptions } from "./mod.ts";

/**
 * The client library and the adapter, or `undefined` where the client library
 * cannot read its files: Deno without `--allow-read`.
 */
const loaded = await (async () => {
  try {
    return {
      ...await import("@platformatic/kafka"),
      ...await import("./mod.ts"),
    };
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "NotCapable" || name === "PermissionDenied") {
      return undefined;
    }
    throw error;
  }
})();

/** `describe`, skipped where the client library cannot be loaded. */
const suite = loaded ? describe : describe.skip;

const { Consumer, Producer, KafkaLinked, KafkaLinker } = loaded ??
  loose({}) as NonNullable<typeof loaded>;

/** Options that are right. Nothing listens on the broker. */
const OPTIONS: KafkaLinkerOptions = {
  brokers: ["127.0.0.1:1"],
  groupId: "mailer",
};

/** A route of a topic. */
const route = (topic: string): Route => ({
  topic,
  name: `Test.${topic}`,
  handle: () => Promise.resolve(undefined),
});

/** Close the clients of a linked application that was never started. */
const close = (linked: Linked) => linked.stop();

suite("KafkaLinker options", () => {
  const rejects = (
    options: unknown,
    message: RegExp,
    code = "CHO_KAFKA_INVALID_OPTION",
  ) => assert.throws(() => new KafkaLinker(loose(options)), { code, message });

  it("needs options", () => {
    rejects(undefined, /^KafkaLinker: expected options/);
  });

  it("needs brokers", () => {
    const message = /^KafkaLinker: the "brokers" option is required/;
    rejects({ groupId: "g" }, message);
    rejects({ brokers: [], groupId: "g" }, message);
    rejects({ brokers: "localhost:9092", groupId: "g" }, message);
    rejects({ brokers: [""], groupId: "g" }, message);
  });

  it("needs a group", () => {
    const message = /^KafkaLinker: the "groupId" option is required/;
    rejects({ brokers: ["a:1"] }, message);
    rejects({ brokers: ["a:1"], groupId: "" }, message);
  });

  it("names an unknown option, and the known ones", () => {
    rejects(
      { ...OPTIONS, group: "g" },
      /unknown option "group"\. Known options: brokers, client, clientId, concurrency, consume, deadLetter, from, groupId, onFatal, retries, retryDelay$/,
      "CHO_CORE_UNKNOWN_OPTION",
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
      {
        code: "CHO_KAFKA_ALREADY_LINKED",
        message:
          "KafkaLinker.link() was already called: use one linker for one application",
      },
    );
    await close(linked);
  });

  it("refuses a topic longer than Kafka accepts", () => {
    const linker = new KafkaLinker(OPTIONS);
    const topic = "a".repeat(250);
    assert.throws(
      () => linker.link([route(topic)]),
      {
        code: "CHO_KAFKA_INVALID_TOPIC",
        message: /the topic of Test\.a+ has 250 characters: Kafka accepts 249/,
      },
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
      {
        code: "CHO_KAFKA_INVALID_DEAD_LETTER",
        message: /the dead-letter topic of "orders" is "orders" itself/,
      },
    );
    assert.throws(
      () =>
        new KafkaLinker({ ...OPTIONS, deadLetter: (topic) => topic }).link([
          route("orders"),
        ]),
      {
        code: "CHO_KAFKA_INVALID_DEAD_LETTER",
        message: /the dead-letter topic of "orders" is "orders" itself/,
      },
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

  it("has a sender before the application is linked, which sends after", async () => {
    const linker = new KafkaLinker(OPTIONS);
    const { sender } = linker;
    await assert.rejects(sender.publish("orders", {}), {
      code: "CHO_KAFKA_NOT_LINKED",
      message:
        "KafkaLinker: there is no producer before the application is created: send after ChoMessage.create resolved",
    });
    assert.equal("request" in sender, false);
    const linked = linker.link([]);
    assert.equal(linker.sender, sender);
    // Its producer is the one of the application: sending is not tried here,
    // with no broker.
    assert.ok(linked.instance.producer instanceof Producer);
    await close(linked);
  });

  it("returns the same promise for every start", async () => {
    const linked = new KafkaLinker(OPTIONS).link([]);
    assert.equal(linked.start(), linked.start());
    await linked.start();
    await linked.stop();
  });
});
