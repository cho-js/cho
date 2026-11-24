/**
 * The validation middleware: {@link validate}.
 *
 * Validation is opt-in. The validators given to the arguments of a handler
 * (`Body(schema)`, `Param("id", schema)`, ...) are run only for the requests
 * this middleware covers: declare it with `@Middlewares` on a handler, on a
 * controller or on a feature module, or give it to the `middlewares` option
 * of `ChoWeb.create`, for the whole application.
 *
 * The middleware only marks the request. The arguments are read at the end
 * of the chain, just before the handler: what reads them finds the mark,
 * runs the validators, and answers a request that is not valid
 * ({@link answer_invalid}).
 *
 * @module
 */

import { type InvalidArgument, mark_validated, validation_of } from "./args.ts";
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
 * as JSON. Each issue has a `message`, and a `path` when it is about a part
 * of the value: the same body for every validator.
 */
function bad_request({ source, key, issues }: ChoWebInvalid): Response {
  return Response.json({
    error: "Invalid request",
    source,
    ...(key === undefined ? {} : { key }),
    issues,
  }, { status: 400 });
}

/**
 * Make the validation middleware.
 *
 * For the handlers it covers, every argument that has a validator goes
 * through it before the handler is called, and what the validator gives is
 * what the handler receives. When an argument is not valid, or the body
 * cannot be parsed, the handler is not called and the request is answered:
 * `400` with a JSON body of `error`, `source`, `key` and `issues`, or what
 * `onInvalid` returns.
 *
 * Wherever it is declared, validation happens at the same moment: after
 * every middleware of the route, just before the handler. So the middlewares
 * of the route see the answer as a response, not as an error. When several
 * cover a handler, the nearest one decides: the handler's, the controller's,
 * the feature's, then the application's.
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
 * @example For the whole application
 * ```ts
 * const app = await ChoWeb.create(AppModule, { middlewares: [validate()] });
 * ```
 *
 * @example Another answer
 * ```ts
 * validate({
 *   onInvalid: ({ source, key, issues }) =>
 *     Response.json({ message: `bad ${source}`, key, issues }, { status: 422 }),
 * });
 * ```
 */
export function validate(
  options: ChoWebValidateOptions = {},
): ChoWebMiddlewareFn {
  const middleware: ChoWebMiddlewareFn = (ctx: ChoWebContext, next) => {
    mark_validated(ctx, options);
    return next();
  };
  VALIDATION.add(middleware);
  return middleware;
}

/**
 * Answer a request with an argument that is not valid: with what the
 * `onInvalid` of the validation middleware returns, or `400`.
 *
 * @param error What {@link evaluate_args} threw.
 * @param ctx The context of the request.
 * @returns The response.
 * @throws What `onInvalid` throws, unchanged: an `HttpError`, say.
 */
export async function answer_invalid(
  error: InvalidArgument,
  ctx: ChoWebContext,
): Promise<Response> {
  const answer = await validation_of(ctx)?.onInvalid?.(error.invalid, ctx);
  // An `onInvalid` that returns nothing has not answered.
  return answer === undefined
    ? bad_request(error.invalid)
    : to_response(answer);
}
