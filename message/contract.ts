/**
 * Contracts: one object that says the topic of a message, what it holds and
 * what is replied.
 *
 * A handler takes a contract in place of a topic (`@Subscribe(contract)`),
 * and who sends gives it to a `ChoMessageClient`: both take their types, and
 * their validators, from the same place. A contract imports nothing of an
 * application, so two services share it as a file or as a package.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import type { ChoMessageContext } from "./context.ts";
import { message_error } from "./errors.ts";
import type { ChoMessageReply } from "./reply.ts";
import { normalize_topic } from "./topic.ts";
import type { ChoMessageValidator } from "./types.ts";

/**
 * What marks a contract made by {@link contract}: a symbol every copy of the
 * package shares.
 */
const BRAND = Symbol.for("cho.message.contract");

/**
 * A contract: the topic of a message, what it holds, and what is replied.
 *
 * @typeParam Request What the message holds: what its handler receives.
 * @typeParam Reply What is replied. `undefined`: nothing.
 */
export type Contract<Request = unknown, Reply = undefined> = {
  /**
   * The whole topic of the message, without the prefix of an application:
   * `"shop.orders.price"`.
   */
  readonly topic: string;
  /** The validator of the value of the message, when it has one. */
  readonly request?: ChoMessageValidator<Request> | undefined;
  /** The validator of the reply, when it has one. */
  readonly reply?: ChoMessageValidator<Reply> | undefined;
};

/**
 * What a handler of a contract returns: the reply, or a `ChoMessageReply`
 * for a reply with headers. A contract with no reply lets it return nothing.
 *
 * @typeParam Reply The reply of the contract.
 */
export type ChoMessageContractResult<Reply> =
  | Reply
  | ChoMessageReply
  | (undefined extends Reply ? void : never);

/**
 * The decorator `@Subscribe(contract)` returns. It only accepts a method that
 * takes the request of the contract, then the context, and returns its
 * reply: a handler that expects or gives something else does not compile.
 *
 * It has both decorator call shapes: standard (TC39) `(method, context)`, and
 * legacy / Bun `(prototype, name, descriptor)`.
 *
 * @typeParam Request What the message holds.
 * @typeParam Reply What is replied.
 */
export type ChoMessageContractDecorator<Request, Reply> = {
  <
    M extends (
      // deno-lint-ignore no-explicit-any
      this: any,
      request: Request,
      ctx: ChoMessageContext,
    ) =>
      | ChoMessageContractResult<Reply>
      | Promise<ChoMessageContractResult<Reply>>,
  >(
    method: M,
    context: ClassMethodDecoratorContext,
  ): void;
  <
    M extends (
      // deno-lint-ignore no-explicit-any
      this: any,
      request: Request,
      ctx: ChoMessageContext,
    ) =>
      | ChoMessageContractResult<Reply>
      | Promise<ChoMessageContractResult<Reply>>,
  >(
    target: object,
    name: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): void;
};

/** Whether a value is a validator: an object with a `parse` method. */
function is_validator(value: unknown): value is ChoMessageValidator {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { parse?: unknown }).parse === "function";
}

/**
 * Make a contract.
 *
 * - `topic` is the whole topic of the message, without the prefix of an
 *   application.
 * - `request` and `reply` are validators: objects with a `parse` method, as
 *   a zod schema is. Both are optional. The types of the contract come from
 *   them; without one, a type can be given by hand, `contract<Order>(…)`,
 *   and nothing checks it.
 * - A contract speaks JSON: the value of the message and the reply are sent
 *   as JSON, both ways.
 *
 * @typeParam Request What the message holds.
 * @typeParam Reply What is replied. Default: nothing.
 * @param options The topic, and the validators.
 * @returns The contract, frozen.
 * @throws {ChoError} `CHO_MESSAGE_INVALID_CONTRACT` when the options are not
 *   an object, or when a validator has no `parse` method;
 *   `CHO_MESSAGE_INVALID_TOPIC` when the topic is not valid, or is empty;
 *   `CHO_CORE_UNKNOWN_OPTION` for an option that does not exist.
 *
 * @example
 * ```ts
 * export const GetPrice = contract({
 *   topic: "shop.orders.price",
 *   request: z.object({ id: z.number() }),
 *   reply: z.object({ id: z.number(), price: z.number() }),
 * });
 *
 * // the service that answers
 * @Subscribe(GetPrice)
 * price(request: { id: number }) {
 *   return { id: request.id, price: 42 };
 * }
 *
 * // the service that asks
 * const { price } = await client.request(GetPrice, { id: 7 });
 * ```
 */
export function contract<Request = unknown, Reply = undefined>(
  options: Contract<Request, Reply>,
): Contract<Request, Reply> {
  if (typeof options !== "object" || options === null) {
    throw message_error(
      "CHO_MESSAGE_INVALID_CONTRACT",
      `contract(): expected options, such as { topic: "shop.orders.price" }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options("contract()", options, ["reply", "request", "topic"]);
  const topic = normalize_topic(options.topic, "contract()");
  if (topic === "") {
    throw message_error(
      "CHO_MESSAGE_INVALID_TOPIC",
      "Invalid topic of contract(): it is empty. A contract has the whole topic of its message",
    );
  }
  for (const name of ["request", "reply"] as const) {
    const validator = options[name];
    if (validator !== undefined && !is_validator(validator)) {
      throw message_error(
        "CHO_MESSAGE_INVALID_CONTRACT",
        `contract(): "${name}" is a validator (an object with a parse method), got ${
          describe(validator)
        }`,
      );
    }
  }
  const made = {
    topic,
    ...(options.request === undefined ? {} : { request: options.request }),
    ...(options.reply === undefined ? {} : { reply: options.reply }),
  };
  // Not enumerable: a contract reads as its three fields.
  Object.defineProperty(made, BRAND, { value: true });
  return Object.freeze(made);
}

/**
 * Whether a value is a contract made by {@link contract}, of any copy of the
 * package.
 *
 * @param value Any value.
 * @returns `true` for a contract.
 */
export function is_contract(value: unknown): value is Contract {
  return typeof value === "object" && value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true;
}
