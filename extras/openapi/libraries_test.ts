/**
 * The schemas of real libraries, in a document: Zod and ArkType.
 *
 * Both implement Standard JSON Schema, so one schema validates an argument
 * and documents it, with no `toJsonSchema` option. The libraries are
 * development dependencies of the workspace: no package depends on them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod";
import { type } from "arktype";
import {
  Body,
  type ChoValidator,
  Controller,
  Doc,
  Middlewares,
  Module,
  Post,
  validate,
} from "@chojs/web";
import { legacy } from "@chojs/core/utils/test_utils";
import { openApiDocument } from "./document.ts";
import { args, create, send } from "./testing.ts";

const libraries: Record<string, ChoValidator> = {
  zod: z.object({ id: z.number(), note: z.string().default("none") }),
  arktype: type({ id: "number", note: "string = 'none'" }),
};

for (const [name, order] of Object.entries(libraries)) {
  describe(`a schema of ${name}, in a document`, () => {
    it("documents the body and a response, and validates the request", async () => {
      class Orders {
        place(placed: unknown) {
          return placed;
        }
      }
      legacy(Post("orders"), Orders, "place");
      legacy(args(Body(order)), Orders, "place");
      legacy(
        Doc({ responses: { 200: { description: "Placed", schema: order } } }),
        Orders,
        "place",
      );
      legacy(Middlewares(validate()), Orders, "place");
      Controller({})(Orders);
      class App {}
      Module({ controllers: [Orders] })(App);
      const app = await create(App);

      const document = openApiDocument(app, {
        info: { title: "Shop", version: "1.0.0" },
      });
      const operation = document.paths["/orders"]!.post!;
      // what a client sends: the note can be left out
      const sent = operation.requestBody!.content!["application/json"]!
        .schema as Record<string, unknown>;
      assert.equal(sent.type, "object");
      assert.deepEqual(sent.required, ["id"]);
      assert.deepEqual(
        (sent.properties as Record<string, { type: string }>).id?.type,
        "number",
      );
      assert.equal("$schema" in sent, false);
      // what the handler gives
      const given = operation.responses[200]!.content!["application/json"]!
        .schema as { properties: Record<string, { type: string }> };
      assert.equal(given.properties.note?.type, "string");

      // the same schema validates
      const post = (body: string) =>
        send(app, "/orders", { method: "POST", body });
      assert.deepEqual(await (await post('{"id":7}')).json(), {
        id: 7,
        note: "none",
      });
      assert.equal((await post('{"id":"x"}')).status, 400);
    });
  });
}
