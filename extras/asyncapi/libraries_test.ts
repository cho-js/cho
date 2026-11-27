/**
 * The schemas of real libraries, in a document: Zod, ArkType and Valibot.
 *
 * Zod and ArkType implement Standard JSON Schema, so one schema validates a
 * message and documents it, with no `toJsonSchema` option. A schema of
 * Valibot validates, and the application gives its JSON Schema. The
 * libraries are development dependencies of the workspace: no package
 * depends on them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod";
import { type } from "arktype";
import * as v from "valibot";
import {
  type ChoValidator,
  contract,
  Middlewares,
  validate,
  Value,
} from "@chojs/message";
import { loose } from "@chojs/core/utils/test_utils";
import { asyncApiDocument } from "./document.ts";
import { docsPage } from "./page.ts";
import { args, controller, create, feature, text } from "./testing.ts";

const INFO = { title: "Shop", version: "1.0.0" };

const libraries: Record<string, ChoValidator> = {
  zod: z.object({ id: z.number(), note: z.string().default("none") }),
  arktype: type({ id: "number", note: "string = 'none'" }),
};

for (const [name, order] of Object.entries(libraries)) {
  describe(`a schema of ${name}, in a document`, () => {
    it("documents a contract and an argument, in draft-07, and validates the message", async () => {
      const Place = contract({
        topic: "orders.place",
        request: order,
        reply: order,
      });
      const Orders = controller("Orders", "orders", {
        place: [Place],
        created: ["created", args(Value(order))],
      });
      Object.assign(Orders.prototype, {
        place: (placed: unknown) => placed,
      });
      Middlewares(loose(validate()))(Orders);
      const app = await create(feature([Orders]));
      const document = asyncApiDocument(app, { info: INFO });

      for (const topic of ["orders.place", "orders.created"]) {
        // what is sent: the note can be left out
        const sent = document.channels[topic]!.messages.message!.payload!;
        assert.equal(sent.type, "object", topic);
        assert.deepEqual(sent.required, ["id"], topic);
        assert.equal(
          (sent.properties as Record<string, { type: string }>).id?.type,
          "number",
        );
        // one dialect for the document: the schema does not say its own
        assert.equal("$schema" in sent, false);
      }
      const reply = document.channels["orders.place/reply"]!.messages.reply!;
      assert.deepEqual(reply.payload!.required, ["id"]);

      // the page shows it
      assert.match(
        text(docsPage(document)),
        /Payload object Name Type What it is id required number note string/,
      );

      // the same schema validates
      const answer = await app.handle("orders.place", { value: '{"id":7}' });
      assert.deepEqual(JSON.parse(new TextDecoder().decode(answer!.value)), {
        id: 7,
        note: "none",
      });
      await assert.rejects(
        app.handle("orders.place", { value: '{"id":"x"}' }),
        { code: "CHO_MESSAGE_INVALID_MESSAGE" },
      );
      await app.close();
    });
  });
}

describe("a schema of valibot, in a document", () => {
  it("has the schema the application gives, with toJsonSchema", async () => {
    const order = v.object({ id: v.number() });
    const Orders = controller("Orders", "orders", {
      created: ["created", args(Value(order))],
    });
    const app = await create(feature([Orders]));

    // Valibot validates, and does not say its own JSON Schema
    const alone = asyncApiDocument(app, { info: INFO });
    assert.deepEqual(alone.channels["orders.created"]!.messages.message, {
      name: "orders.created",
      contentType: "application/json",
    });

    const schema = {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    };
    const document = asyncApiDocument(app, {
      info: INFO,
      toJsonSchema: (validator) => validator === order ? schema : undefined,
    });
    assert.deepEqual(
      document.channels["orders.created"]!.messages.message!.payload,
      schema,
    );
    await app.close();
  });
});
