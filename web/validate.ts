/**
 * The validation middleware: {@link validate}.
 *
 * Validation is opt-in. The validators given to the arguments of a handler
 * (`Body(schema)`, `Param("id", schema)`, ...) are run only for the requests
 * this middleware covers: declare it with `@Middlewares` on a handler, on a
 * controller or on a feature module.
 *
 * @module
 */

import { InvalidArgument, mark_validated } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import { to_response } from "./response.ts";
import type {
  ChoWebInvalid,
  ChoWebMiddlewareFn,
  ChoWebValidateOptions,
} from "./types.ts";

/** The middlewares made by {@link validate}. */
const VALIDATION = new WeakSet<ChoWebMiddlewareFn>();

/**
 * Whether a middleware was made by {@link validate}.
 *
 * @param middleware A middleware function.
 * @returns `true` for a validation middleware.
 */
export function is_validation(middleware: ChoWebMiddlewareFn): boolean {
  return VALIDATION.has(middleware);
}

/**
 * The default answer to a request that is not valid: `400`, with what failed
 * as JSON. `issues` are those of the error when it has them, as a zod error
 * does, and otherwise one issue with the error's message.
 */
function bad_request({ source, key, error }: ChoWebInvalid): Response {
  const issues = (error as { issues?: unknown } | null)?.issues;
  return Response.json({
    error: "Invalid request",
    source,
    ...(key === undefined ? {} : { key }),
    issues: Array.isArray(issues)
      ? issues
      : [{ message: error instanceof Error ? error.message : String(error) }],
  }, { status: 400 });
}

/**
 * Make the validation middleware.
 *
 * For the handlers it covers, every argument that has a validator goes
 * through it before the handler is called, and what the validator returns is
 * what the handler receives. When an argument is not valid, or the body
 * cannot be parsed, the handler is not called and the middleware answers:
 * `400` with a JSON body of `error`, `source`, `key` and `issues`, or what
 * `onInvalid` returns.
 *
 * Wherever it is declared, validation happens at the same moment: after
 * every middleware of the route, just before the handler.
 *
 * @param options How to answer a request that is not valid.
 * @returns The middleware, for `@Middlewares`.
 *
 * @example
 * ```ts
 * @Middlewares(validate())
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Post("")
 *   @Args(Body(NewUser))
 *   create(user: NewUser) {
 *     return this.store.add(user);
 *   }
 * }
 * ```
 *
 * @example Another answer
 * ```ts
 * validate({
 *   onInvalid: ({ source, key }) =>
 *     Response.json({ message: `bad ${source}`, key }, { status: 422 }),
 * });
 * ```
 */
export function validate(
  options: ChoWebValidateOptions = {},
): ChoWebMiddlewareFn {
  const on_invalid = options.onInvalid;
  const middleware: ChoWebMiddlewareFn = async (
    ctx: ChoWebContext,
    next,
  ) => {
    mark_validated(ctx);
    try {
      return await next();
    } catch (error) {
      if (!(error instanceof InvalidArgument)) {
        throw error;
      }
      const answer = await on_invalid?.(error.invalid, ctx);
      // An `onInvalid` that returns nothing has not answered.
      return answer === undefined
        ? bad_request(error.invalid)
        : to_response(answer);
    }
  };
  VALIDATION.add(middleware);
  return middleware;
}
