/**
 * The schemas of real libraries, as validators: Zod, Valibot and ArkType.
 *
 * Every other test writes its validators by hand. These run one schema of
 * each library through what takes a validator, in `@chojs/core`, `@chojs/web`
 * and `@chojs/message`, and check the types each library gives.
 *
 * The libraries are development dependencies of the workspace: no package
 * depends on them. A schema of Valibot is an object with no `parse` method,
 * and a schema of ArkType is a function: both are validators by their
 * `~standard` key alone.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod";
import * as v from "valibot";
import { type } from "arktype";
import type { ChoInput, ChoOutput, ChoValidator } from "@chojs/core";
import { is_validator, run_validator } from "@chojs/core/utils";
import {
  Args,
  Body,
  ChoWeb,
  type ChoWebArg,
  Controller as WebController,
  Get,
  Middlewares as WebMiddlewares,
  Module as WebModule,
  Post,
  Query,
  validate as web_validate,
} from "@chojs/web";
import { type ChoMessageArg, Value } from "./mod.ts";
import { ChoMessageClient, localSender } from "./client.ts";
import { contract } from "./contract.ts";
import { Controller, Middlewares, Module, Subscribe } from "./decorators.ts";
import { ChoMessage } from "./message.ts";
import { validate } from "./validate.ts";

/** What who asks sends: the note can be left out. */
type Draft = { id: number; note?: string | undefined };
/** What the handler receives: the schema gave the note a default. */
type Placed = { id: number; note: string };
/** What the handler returns: a price in cents. */
type Cents = { cents: number };
/** What who asks receives: the schema converted it. */
type Amount = { amount: number };

// An order: its input and its output differ by a default.
const ZodOrder = z.object({ id: z.number(), note: z.string().default("none") });
const ValibotOrder = v.object({
  id: v.number(),
  note: v.optional(v.string(), "none"),
});
const ArkOrder = type({ id: "number", note: "string = 'none'" });

// An amount: its input and its output differ by a conversion.
const ZodAmount = z.object({ cents: z.number() }).transform(({ cents }) => ({
  amount: cents / 100,
}));
const ValibotAmount = v.pipe(
  v.object({ cents: v.number() }),
  v.transform(({ cents }) => ({ amount: cents / 100 })),
);
const ArkAmount = type({ cents: "number" }).pipe(({ cents }) => ({
  amount: cents / 100,
}));

/**
 * The schemas of each library. That this compiles is a test: each schema is
 * a validator of the same two types.
 */
const libraries: Record<string, {
  order: ChoValidator<Placed, Draft>;
  amount: ChoValidator<Amount, Cents>;
}> = {
  zod: { order: ZodOrder, amount: ZodAmount },
  valibot: { order: ValibotOrder, amount: ValibotAmount },
  arktype: { order: ArkOrder, amount: ArkAmount },
};

const PlaceWithZod = contract({
  topic: "shop.zod.place",
  request: ZodOrder,
  reply: ZodAmount,
});
const PlaceWithValibot = contract({
  topic: "shop.valibot.place",
  request: ValibotOrder,
  reply: ValibotAmount,
});
const PlaceWithArk = contract({
  topic: "shop.arktype.place",
  request: ArkOrder,
  reply: ArkAmount,
});

const contracts = {
  zod: PlaceWithZod,
  valibot: PlaceWithValibot,
  arktype: PlaceWithArk,
};

for (const [name, { order, amount }] of Object.entries(libraries)) {
  describe(`a schema of ${name}, as a validator`, () => {
    it("is a validator", () => {
      assert.equal(is_validator(order), true);
      assert.equal(is_validator(amount), true);
    });

    it("gives its output: a default, and a conversion", async () => {
      assert.deepEqual(await run_validator(order, { id: 1 }), {
        value: { id: 1, note: "none" },
      });
      assert.deepEqual(await run_validator(amount, { cents: 450 }), {
        value: { amount: 4.5 },
      });
    });

    it("gives its issues as a message and a path, and nothing else", async () => {
      const result = await run_validator(order, { id: "x", note: 5 });
      assert.equal(result.issues?.length, 2);
      assert.equal("error" in result, false);
      for (const issue of result.issues ?? []) {
        assert.deepEqual(Object.keys(issue), ["message", "path"]);
        assert.equal(typeof issue.message, "string");
        assert.notEqual(issue.message, "");
      }
      assert.deepEqual(result.issues?.map((issue) => issue.path), [
        ["id"],
        ["note"],
      ]);
      // the whole value is what is wrong: no path
      const whole = await run_validator(order, null);
      assert.deepEqual(whole.issues?.map((issue) => Object.keys(issue)), [[
        "message",
      ]]);
    });

    it("validates the body of a request of @chojs/web", async () => {
      class Orders {
        place(placed: unknown) {
          return placed;
        }
      }
      // Decorators are applied by hand, as in the other tests.
      const descriptor = Object.getOwnPropertyDescriptor(
        Orders.prototype,
        "place",
      )!;
      Post("orders")(Orders.prototype, "place", descriptor);
      Args(Body(order))(Orders.prototype, "place", descriptor);
      WebMiddlewares(web_validate())(Orders);
      WebController()(Orders);
      class App {}
      WebModule({ controllers: [Orders] })(App);
      const app = await ChoWeb.create(App);
      const post = (body: string) =>
        app.handler(
          new Request("http://localhost/orders", { method: "POST", body }),
        );

      const placed = await post('{"id":7}');
      assert.equal(placed.status, 200);
      assert.deepEqual(await placed.json(), { id: 7, note: "none" });

      const refused = await post('{"id":"x"}');
      assert.equal(refused.status, 400);
      const answer = await refused.json();
      assert.deepEqual(
        { ...answer, issues: answer.issues.map(Object.keys) },
        {
          error: "Invalid request",
          source: "body",
          issues: [["message", "path"]],
        },
      );
      assert.deepEqual(answer.issues[0].path, ["id"]);
    });

    it("validates both sides of a contract of @chojs/message", async () => {
      const place = contracts[name as keyof typeof contracts];
      const seen: unknown[] = [];
      class Orders {
        place(placed: Placed): Cents {
          seen.push(placed);
          return { cents: placed.id * 150 };
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        Orders.prototype,
        "place",
      )!;
      Subscribe(place)(Orders.prototype, "place", descriptor);
      Middlewares(validate())(Orders);
      Controller()(Orders);
      class App {}
      Module({ controllers: [Orders] })(App);
      const app = await ChoMessage.create(App);
      const client = new ChoMessageClient(localSender(app));

      // who asks sends the input of the request, and receives the output of
      // the reply
      const amount: Amount = await client.request(place, { id: 3 });
      assert.deepEqual(amount, { amount: 4.5 });
      // the handler received the output of the request
      assert.deepEqual(seen, [{ id: 3, note: "none" }]);

      await assert.rejects(
        client.request(place, { id: "x" } as unknown as Draft),
        { code: "CHO_MESSAGE_INVALID_MESSAGE" },
      );
      assert.equal(seen.length, 1);
    });
  });
}

describe("a schema of zod with an asynchronous check", () => {
  it("is awaited: it needs no wrapper", async () => {
    const Free = z.string().refine(async (name) => {
      await Promise.resolve();
      return name !== "taken";
    }, "The name is taken");
    class Names {
      check(name: string) {
        return { name };
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Names.prototype,
      "check",
    )!;
    Get("names")(Names.prototype, "check", descriptor);
    Args(Query("name", Free))(Names.prototype, "check", descriptor);
    WebMiddlewares(web_validate())(Names);
    WebController()(Names);
    class App {}
    WebModule({ controllers: [Names] })(App);
    const app = await ChoWeb.create(App);
    const get = (name: string) =>
      app.handler(new Request(`http://localhost/names?name=${name}`));

    assert.deepEqual(await (await get("ada")).json(), { name: "ada" });
    const refused = await get("taken");
    assert.equal(refused.status, 400);
    assert.deepEqual((await refused.json()).issues, [{
      message: "The name is taken",
    }]);
  });
});

describe("the types of the schemas of the libraries", () => {
  it("gives the input and the output of each", () => {
    // The output has the note, and the input can leave it out.
    const outputs: Placed[] = [
      {} as ChoOutput<typeof ZodOrder>,
      {} as ChoOutput<typeof ValibotOrder>,
      {} as ChoOutput<typeof ArkOrder>,
    ];
    const zod_draft: ChoInput<typeof ZodOrder> = { id: 1 };
    const valibot_draft: ChoInput<typeof ValibotOrder> = { id: 1 };
    const ark_draft: ChoInput<typeof ArkOrder> = { id: 1 };
    // @ts-expect-error the output of zod always has a note
    const zod_placed: ChoOutput<typeof ZodOrder> = { id: 1 };
    // @ts-expect-error the output of valibot always has a note
    const valibot_placed: ChoOutput<typeof ValibotOrder> = { id: 1 };
    // @ts-expect-error the output of arktype always has a note
    const ark_placed: ChoOutput<typeof ArkOrder> = { id: 1 };
    // A conversion: cents go in, an amount comes out.
    const cents: [
      ChoInput<typeof ZodAmount>,
      ChoInput<typeof ValibotAmount>,
      ChoInput<typeof ArkAmount>,
    ] = [{ cents: 1 }, { cents: 1 }, { cents: 1 }];
    const amounts: Amount[] = [
      {} as ChoOutput<typeof ZodAmount>,
      {} as ChoOutput<typeof ValibotAmount>,
      {} as ChoOutput<typeof ArkAmount>,
    ];
    assert.equal(
      [
        outputs,
        zod_draft,
        valibot_draft,
        ark_draft,
        zod_placed,
        valibot_placed,
        ark_placed,
        cents,
        amounts,
      ].length,
      9,
    );
  });

  it("types an argument of a handler by the output of its schema", () => {
    const web: ChoWebArg<Placed>[] = [
      Body(ZodOrder),
      Body(ValibotOrder),
      Body(ArkOrder),
      Query("order", ZodOrder),
    ];
    const message: ChoMessageArg<Placed>[] = [
      Value(ZodOrder),
      Value(ValibotOrder),
      Value("order", ArkOrder),
    ];
    const converted: ChoWebArg<Amount>[] = [
      Body(ZodAmount),
      Body(ValibotAmount),
      Body(ArkAmount),
    ];
    // @ts-expect-error the handler receives an amount, not cents
    const zod_cents: ChoWebArg<Cents> = Body(ZodAmount);
    // @ts-expect-error the handler receives an amount, not cents
    const valibot_cents: ChoMessageArg<Cents> = Value(ValibotAmount);
    // @ts-expect-error the handler receives an amount, not cents
    const ark_cents: ChoWebArg<Cents> = Body(ArkAmount);
    assert.equal(web.length + message.length + converted.length, 10);
    assert.equal([zod_cents, valibot_cents, ark_cents].length, 3);
  });

  it("types both sides of a contract, for each library", () => {
    // Type-only: never called.
    const _check = async (client: ChoMessageClient) => {
      for (const place of [PlaceWithZod, PlaceWithValibot, PlaceWithArk]) {
        // The note can be left out, and the reply is an amount.
        const amount: Amount = await client.request(place, { id: 1 });
        // @ts-expect-error who asks receives an amount, not cents
        const cents: Cents = await client.request(place, { id: 1 });
        // @ts-expect-error the id is needed
        await client.publish(place, { note: "no id" });
        // @ts-expect-error a note is a string
        await client.publish(place, { id: 1, note: 5 });
        void [amount, cents];
      }
      // The handler receives the note, and returns cents.
      const good = (order: Placed): Cents => ({ cents: order.note.length });
      const bad = (_order: Placed): Amount => ({ amount: 1 });
      const descriptor = { value: good };
      const wrong = { value: bad };
      Subscribe(PlaceWithZod)({}, "place", descriptor);
      Subscribe(PlaceWithValibot)({}, "place", descriptor);
      Subscribe(PlaceWithArk)({}, "place", descriptor);
      // @ts-expect-error the handler returns cents, not an amount
      Subscribe(PlaceWithZod)({}, "place", wrong);
      // @ts-expect-error the handler returns cents, not an amount
      Subscribe(PlaceWithValibot)({}, "place", wrong);
      // @ts-expect-error the handler returns cents, not an amount
      Subscribe(PlaceWithArk)({}, "place", wrong);
    };
    assert.equal(typeof _check, "function");
  });
});
