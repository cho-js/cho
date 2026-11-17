/**
 * Tests for the Kafka adapter against a real broker: what only Kafka can
 * tell. A message is delivered and committed, a failed one is tried again and
 * goes to the dead-letter topic, a partition keeps its order, and a second
 * start of the group does not read what was committed.
 *
 * They run on Node.js, when `KAFKA_BROKERS` is set, and are skipped otherwise:
 *
 * ```sh
 * docker run -d --rm -p 9092:9092 apache/kafka:4.1.0
 * KAFKA_BROKERS=localhost:9092 npx tsx --test vendor/kafka/kafka_test.ts
 * ```
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ChoMessage,
  type ChoMessageContext,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";
import { engine, env } from "@chojs/core/utils";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import type { KafkaNative } from "./mod.ts";

const BROKERS = (env("KAFKA_BROKERS") ?? "").split(",").filter(Boolean);

/** Whether the tests run: on Node.js, with a broker. */
const RUN = engine() === "node" && BROKERS.length > 0;

/** `describe`, skipped without a broker, or off Node.js. */
const suite = RUN ? describe : describe.skip;

// Loaded only when the tests run: the client library reads its files when
// it loads.
const { Admin, Consumer, stringDeserializers } = RUN
  ? await import("@platformatic/kafka")
  : loose({});
const { DEAD_LETTER_HEADERS, KafkaLinker } = RUN
  ? await import("./mod.ts")
  : loose({}) as typeof import("./mod.ts");

/** A name no other run of the tests has. */
const unique = (name: string) =>
  `cho-test-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Create topics, with the given number of partitions. */
async function create_topics(topics: string[], partitions = 1) {
  const admin = new Admin({ clientId: "cho-test", bootstrapBrokers: BROKERS });
  try {
    await admin.createTopics({ topics, partitions, replicas: 1 });
  } finally {
    await admin.close();
  }
}

/** Resolves when `done()` is true; rejects after the timeout. */
async function until(done: () => boolean, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) {
      throw new Error(`timeout: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** An application with one handler, of the topic `<prefix>.created`. */
function orders_app(handler: (ctx: ChoMessageContext) => unknown) {
  class Orders {
    created(ctx: ChoMessageContext) {
      return handler(ctx);
    }
  }
  legacy(Subscribe("created"), Orders, "created");
  loose(Controller({ topic: "orders" }))(Orders);
  class App {}
  loose(Module({ controllers: [Orders] }))(App);
  return App;
}

suite("KafkaLinker, with a broker", { timeout: 120_000 }, () => {
  it("delivers a message, with its key, headers and native message", async () => {
    const prefix = unique("deliver");
    const topic = `${prefix}.orders.created`;
    await create_topics([topic]);
    const seen: unknown[] = [];
    const app = await ChoMessage.create(
      orders_app((ctx) => {
        const native = ctx.native as KafkaNative;
        seen.push({
          topic: ctx.topic,
          key: ctx.key,
          value: ctx.json(),
          headers: ctx.headers,
          partition: native.message.partition,
          offset: native.message.offset,
          attempt: native.attempt,
        });
      }),
      {
        prefix,
        linker: new KafkaLinker({
          brokers: BROKERS,
          groupId: unique("group"),
          from: "earliest",
        }),
      },
    );
    await app.start();
    const { producer } = app.linked.instance;
    await producer.send({
      messages: [{
        topic,
        key: Buffer.from("k1"),
        value: Buffer.from(JSON.stringify({ id: 1 })),
        headers: new Map([[Buffer.from("message-id"), Buffer.from("abc")]]),
      }],
    });
    await until(() => seen.length === 1, "the message is handled");
    await app.close();
    assert.deepEqual(seen, [{
      topic,
      key: "k1",
      value: { id: 1 },
      headers: { "message-id": "abc" },
      partition: 0,
      offset: 0n,
      attempt: 1,
    }]);
  });

  it("does not deliver a committed message again", async () => {
    const prefix = unique("commit");
    const topic = `${prefix}.orders.created`;
    const groupId = unique("group");
    await create_topics([topic]);
    const seen: string[] = [];
    const start = async () => {
      const app = await ChoMessage.create(
        orders_app((ctx) => void seen.push(ctx.text())),
        {
          prefix,
          linker: new KafkaLinker({
            brokers: BROKERS,
            groupId,
            from: "earliest",
          }),
        },
      );
      await app.start();
      return app;
    };
    const first = await start();
    await first.linked.instance.producer.send({
      messages: [{ topic, value: Buffer.from("one") }],
    });
    await until(() => seen.length === 1, "the first message is handled");
    await first.close();

    const second = await start();
    await second.linked.instance.producer.send({
      messages: [{ topic, value: Buffer.from("two") }],
    });
    await until(() => seen.length >= 2, "the second message is handled");
    await second.close();
    assert.deepEqual(seen, ["one", "two"]);
  });

  it("tries a failed message again, then sends it to the dead letters", async () => {
    const prefix = unique("dead");
    const topic = `${prefix}.orders.created`;
    const dead = `${topic}.dead`;
    const groupId = unique("group");
    await create_topics([topic, dead]);
    const attempts: string[] = [];
    const app = await ChoMessage.create(
      orders_app((ctx) => {
        const text = ctx.text();
        attempts.push(`${text}#${(ctx.native as KafkaNative).attempt}`);
        if (text === "bad") {
          throw new Error("no such order");
        }
      }),
      {
        prefix,
        linker: new KafkaLinker({
          brokers: BROKERS,
          groupId,
          from: "earliest",
          retries: 2,
          retryDelay: 10,
          deadLetter: (name) => `${name}.dead`,
        }),
      },
    );
    await app.start();
    await app.linked.instance.producer.send({
      messages: [
        { topic, key: Buffer.from("k"), value: Buffer.from("bad") },
        { topic, value: Buffer.from("good") },
      ],
    });
    await until(
      () => attempts.includes("good#1"),
      "the next message is handled",
    );
    await app.close();
    // The partition waited for the failed message, then went on.
    assert.deepEqual(attempts, ["bad#1", "bad#2", "bad#3", "good#1"]);

    const consumer = new Consumer({
      clientId: "cho-test",
      groupId: unique("reader"),
      bootstrapBrokers: BROKERS,
      deserializers: stringDeserializers,
    });
    const stream = await consumer.consume({
      topics: [dead],
      mode: "earliest",
      autocommit: false,
    });
    let letter;
    for await (const message of stream) {
      letter = message;
      break;
    }
    await consumer.close(true);
    assert.ok(letter);
    assert.equal(letter.key, "k");
    assert.equal(letter.value, "bad");
    assert.deepEqual(Object.fromEntries(letter.headers), {
      [DEAD_LETTER_HEADERS.topic]: topic,
      [DEAD_LETTER_HEADERS.partition]: "0",
      [DEAD_LETTER_HEADERS.offset]: "0",
      [DEAD_LETTER_HEADERS.group]: groupId,
      [DEAD_LETTER_HEADERS.attempts]: "3",
      [DEAD_LETTER_HEADERS.error]: "no such order",
    });
  });

  it("stops without a dead-letter topic, and delivers the message again", async () => {
    const prefix = unique("fatal");
    const topic = `${prefix}.orders.created`;
    const groupId = unique("group");
    await create_topics([topic]);
    const seen: string[] = [];
    let fatal: Error | undefined;
    let fail = true;
    const start = async () => {
      const app = await ChoMessage.create(
        orders_app((ctx) => {
          seen.push(ctx.text());
          if (fail) {
            throw new Error("down");
          }
        }),
        {
          prefix,
          linker: new KafkaLinker({
            brokers: BROKERS,
            groupId,
            from: "earliest",
            retries: 1,
            retryDelay: 10,
            onFatal: (error) => (fatal = error),
          }),
        },
      );
      await app.start();
      return app;
    };
    const first = await start();
    await first.linked.instance.producer.send({
      messages: [{ topic, value: Buffer.from("one") }],
    });
    await until(() => fatal !== undefined, "the consumer stops");
    assert.match(fatal!.message, /failed 2 time\(s\) for .*\[0\]@0/);
    assert.equal((fatal!.cause as Error).message, "down");
    await first.close();

    fail = false;
    const second = await start();
    await until(() => seen.length === 3, "the message is delivered again");
    await second.close();
    assert.deepEqual(seen, ["one", "one", "one"]);
  });

  it("keeps the order of a partition, with partitions in parallel", async () => {
    const prefix = unique("order");
    const topic = `${prefix}.orders.created`;
    await create_topics([topic], 3);
    const seen = new Map<number, number[]>();
    let running = 0;
    let most = 0;
    const app = await ChoMessage.create(
      orders_app(async (ctx) => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        const { partition } = (ctx.native as KafkaNative).message;
        seen.set(partition, [
          ...(seen.get(partition) ?? []),
          Number(ctx.text()),
        ]);
      }),
      {
        prefix,
        linker: new KafkaLinker({
          brokers: BROKERS,
          groupId: unique("group"),
          from: "earliest",
          concurrency: 3,
        }),
      },
    );
    await app.start();
    const messages = Array.from({ length: 60 }, (_, i) => ({
      topic,
      partition: i % 3,
      value: Buffer.from(String(i)),
    }));
    await app.linked.instance.producer.send({ messages });
    const count = () =>
      [...seen.values()].reduce((n, list) => n + list.length, 0);
    await until(() => count() === 60, "every message is handled");
    await app.close();
    for (const [partition, list] of seen) {
      assert.deepEqual(
        list,
        list.toSorted((a, b) => a - b),
        `partition ${partition}`,
      );
      assert.equal(list.length, 20);
    }
    assert.ok(most > 1, "partitions ran together");
    assert.ok(most <= 3, "no more than the concurrency");
  });

  it("goes on after another instance joins the group", async () => {
    const prefix = unique("rebalance");
    const topic = `${prefix}.orders.created`;
    const groupId = unique("group");
    await create_topics([topic], 2);
    const seen = new Set<string>();
    const start = async () => {
      const app = await ChoMessage.create(
        orders_app((ctx) => void seen.add(ctx.text())),
        {
          prefix,
          linker: new KafkaLinker({
            brokers: BROKERS,
            groupId,
            from: "earliest",
            retryDelay: 10,
          }),
        },
      );
      await app.start();
      return app;
    };
    const send = (from: number, to: number) =>
      first.linked.instance.producer.send({
        messages: Array.from({ length: to - from }, (_, i) => ({
          topic,
          partition: (from + i) % 2,
          value: Buffer.from(String(from + i)),
        })),
      });
    const first = await start();
    await send(0, 10);
    await until(() => seen.size === 10, "the first messages are handled");
    const second = await start();
    await send(10, 30);
    await until(() => seen.size === 30, "the messages after the rebalance");
    await second.close();
    await send(30, 40);
    await until(() => seen.size === 40, "the messages after the second left");
    await first.close();
  });
});
