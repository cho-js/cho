/**
 * Tests for `topic.ts`: the rules of a topic, and joining its levels.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assert_topic, join_topic, normalize_topic } from "./topic.ts";

describe("assert_topic", () => {
  it("accepts names, and segments separated by dots", () => {
    for (
      const topic of [
        "",
        "orders",
        "orders.created",
        "shop.orders.created",
        "orders-created",
        "orders_created",
        "Orders.V2",
        "a.b-c.d_e.42",
      ]
    ) {
      assert.doesNotThrow(() => assert_topic(topic, "here"), topic);
    }
  });

  it("rejects a topic that is not a string", () => {
    for (const topic of [undefined, null, 42, ["orders"], {}]) {
      assert.throws(
        () => assert_topic(topic, "feature App"),
        (error: unknown) =>
          error instanceof TypeError &&
          error.message.startsWith(
            "Invalid topic of feature App: expected a string, got ",
          ),
      );
    }
  });

  it("rejects a leading or trailing dot", () => {
    for (const topic of [".orders", "orders.", "."]) {
      assert.throws(() => assert_topic(topic, "here"), {
        message: `Invalid topic ${
          JSON.stringify(topic)
        } of here: it must not start or end with "."`,
      });
    }
  });

  it("rejects an empty segment", () => {
    assert.throws(() => assert_topic("orders..created", "here"), {
      message:
        'Invalid topic "orders..created" of here: it must not contain an empty segment ("..")',
    });
  });

  it("rejects the wildcards of the brokers", () => {
    for (
      const [topic, segment, char] of [
        ["orders.*", "*", "*"],
        ["orders.>", ">", ">"],
        ["orders.#", "#", "#"],
        ["orders.cre*ted", "cre*ted", "*"],
      ] as const
    ) {
      assert.throws(() => assert_topic(topic, "here"), {
        message: `Invalid topic ${JSON.stringify(topic)} of here: ${
          JSON.stringify(segment)
        } has a "${char}": wildcards are not part of the topic syntax`,
      });
    }
  });

  it("rejects a segment with any other character", () => {
    for (
      const [topic, segment] of [
        ["orders created", "orders created"],
        ["orders/created", "orders/created"],
        ["orders.:id", ":id"],
        ["orders.créé", "créé"],
        ["orders.a@b", "a@b"],
      ] as const
    ) {
      assert.throws(() => assert_topic(topic, "here"), {
        message: `Invalid topic ${JSON.stringify(topic)} of here: ${
          JSON.stringify(segment)
        } is not a valid segment: write letters, digits, "_" and "-"`,
      });
    }
  });
});

describe("normalize_topic", () => {
  it("trims the topic", () => {
    assert.equal(
      normalize_topic("  orders.created \n", "here"),
      "orders.created",
    );
    assert.equal(normalize_topic("   ", "here"), "");
  });

  it("checks the trimmed topic", () => {
    assert.throws(() => normalize_topic(" orders. ", "here"), {
      message:
        'Invalid topic "orders." of here: it must not start or end with "."',
    });
    assert.throws(() => normalize_topic(7, "here"), TypeError);
  });
});

describe("join_topic", () => {
  it("joins the levels with a dot, and skips the empty ones", () => {
    assert.equal(
      join_topic(["staging", "shop", "orders", "created"]),
      "staging.shop.orders.created",
    );
    assert.equal(join_topic(["", "", "orders", "created"]), "orders.created");
    assert.equal(join_topic(["", "shop.orders", "", ""]), "shop.orders");
    assert.equal(join_topic(["", "", "", ""]), "");
  });
});
