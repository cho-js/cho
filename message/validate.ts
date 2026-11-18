/**
 * The validation middleware: {@link validate}.
 *
 * A validator given to an argument (`Value(schema)`) is run only for a
 * handler this middleware covers: declare it with `@Middlewares` on a
 * handler, on a controller or on a feature module.
 *
 * The middleware itself only marks its place. The arguments of a handler are
 * evaluated, and validated, at the end of the chain (see `build-graph.ts`):
 * a chain of `@chojs/message` has no result, so a middleware could not turn
 * a message that is not valid into a handled one.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { message_error } from "./errors.ts";
import type {
  ChoMessageMiddlewareFn,
  ChoMessageValidateOptions,
} from "./types.ts";

/** The middlewares made by {@link validate}, with their options. */
const VALIDATION = new WeakMap<
  ChoMessageMiddlewareFn,
  ChoMessageValidateOptions
>();

/**
 * The options of a validation middleware.
 *
 * @param middleware A middleware function.
 * @returns The options given to {@link validate}, or `undefined` when the
 *   middleware was not made by it.
 */
export function validation_of(
  middleware: ChoMessageMiddlewareFn,
): ChoMessageValidateOptions | undefined {
  return VALIDATION.get(middleware);
}

/**
 * Make the validation middleware.
 *
 * For the handlers it covers, every argument that has a validator goes
 * through it before the handler is called, and what the validator returns is
 * what the handler receives. When an argument is not valid, or the value
 * cannot be parsed as JSON, the handler is not called and the message fails,
 * with a `ChoError` of the code `CHO_MESSAGE_INVALID_MESSAGE`: an adapter
 * does not try such a message again. `onInvalid` decides otherwise.
 *
 * Wherever it is declared, validation happens at the same moment: after
 * every middleware of the route, just before the handler. When several cover
 * a handler, the nearest one decides: the handler's, then the controller's,
 * then the feature's.
 *
 * @param options What a message that is not valid leads to.
 * @returns The middleware, for `@Middlewares`.
 * @throws {ChoError} When the options are not an object, when one is unknown,
 *   or when `onInvalid` is not a function.
 *
 * @example
 * ```ts
 * @Middlewares(validate())
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   @Subscribe("created")
 *   @Args(Value(Order))
 *   created(order: Order) {
 *     return this.store.add(order);
 *   }
 * }
 * ```
 *
 * @example Skip a message that is not valid
 * ```ts
 * validate({
 *   onInvalid: ({ source, key, error }, ctx) => {
 *     console.error(ctx.topic, source, key, error);
 *     return true; // handled: it is not delivered again
 *   },
 * });
 * ```
 */
export function validate(
  options: ChoMessageValidateOptions = {},
): ChoMessageMiddlewareFn {
  if (typeof options !== "object" || options === null) {
    throw message_error(
      "CHO_MESSAGE_INVALID_ARGUMENT",
      `validate(): expected options, such as { onInvalid: (invalid, ctx) => true }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options("validate()", options, ["onInvalid"]);
  const { onInvalid } = options;
  if (onInvalid !== undefined && typeof onInvalid !== "function") {
    throw message_error(
      "CHO_MESSAGE_INVALID_ARGUMENT",
      `validate(): "onInvalid" is a function, got ${describe(onInvalid)}`,
    );
  }
  const middleware: ChoMessageMiddlewareFn = (_ctx, next) => next();
  VALIDATION.set(middleware, options);
  return middleware;
}
