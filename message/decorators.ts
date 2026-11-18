/**
 * The decorators of `@chojs/message`.
 *
 * - `@Subscribe` marks the message handlers of a controller. It writes the
 *   handler's topic on the decorated method, under the private `SUBSCRIBE`
 *   key (`keys.ts`), which the graph builder reads (see `build-graph.ts`).
 * - `@Args` declares the arguments of a handler. It writes them under the
 *   private `ARGS` key.
 * - `@Module` and `@Controller` are the core's decorators, with the `topic`
 *   option of `@chojs/message`. They accept no other option.
 * - `@Middlewares` and `@Catch` declare the middlewares and the error handler
 *   of a feature module, a controller or a handler. They are the core's
 *   decorators, typed for `@chojs/message`.
 *
 * @module
 */

import { message_error } from "./errors.ts";
import {
  add_to_metadata_object,
  assert_known_options,
  type ChoClassOrMethodDecorator,
  type ChoInjectableDecorator,
  type ChoMethodDecorator,
  Controller as CoreController,
  type ControllerOptions,
  decorated_method,
  decorated_target,
  type Dependency,
  Module as CoreModule,
  type ModuleOptions,
  read_metadata_object,
  set_error_handler,
  set_middlewares,
  type WithDependencies,
} from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import {
  ARGS,
  handler_args,
  type HandlerArgs,
  SUBSCRIBE,
  type Subscription,
  subscription,
} from "./keys.ts";
import { normalize_topic } from "./topic.ts";
import type {
  ChoMessageArg,
  ChoMessageArgsDecorator,
  ChoMessageArgValues,
  ChoMessageErrorHandler,
  ChoMessageMiddleware,
} from "./types.ts";

/** The option `@chojs/message` adds to `@Module` and `@Controller`. */
export type TopicOption = {
  /**
   * The topic of the feature module or of the controller: segments of
   * letters, digits, `_` and `-`, separated by `.` (`"orders"`,
   * `"shop.orders"`). It comes before the topics of what the module or the
   * controller holds. Default: none.
   */
  topic?: string;
};

/**
 * Options of `@Module` in a message application: the module options of the
 * core, and the `topic` of the feature.
 */
export type MessageModuleOptions<
  D extends readonly Dependency[] = readonly Dependency[],
> = WithDependencies<Partial<ModuleOptions>, D> & TopicOption;

/**
 * Options of `@Controller` in a message application: its `dependencies`, and
 * its `topic`.
 */
export type MessageControllerOptions<
  D extends readonly Dependency[] = readonly Dependency[],
> = WithDependencies<Partial<ControllerOptions>, D> & TopicOption;

/**
 * Mark a class as a module (see `@Module` of `@chojs/core`). A module that
 * declares controllers is a feature: its `topic` comes before the topics of
 * its controllers.
 *
 * @param options What the module imports, declares and exports, and its
 *   `topic`.
 * @returns The class decorator.
 * @throws {ChoError} When an option is unknown or invalid, or when the class
 *   already has a DI decorator.
 *
 * @example
 * ```ts
 * @Module({ topic: "shop", providers: [Mailer], controllers: [OrdersController] })
 * class App {}
 * ```
 */
export function Module<const D extends readonly Dependency[] = []>(
  options: MessageModuleOptions<D> = {},
): ChoInjectableDecorator<NoInfer<D>> {
  assert_known_options("@Module()", options, [
    "dependencies",
    "imports",
    "providers",
    "controllers",
    "exports",
    "topic",
  ]);
  return CoreModule<TopicOption, D>(options);
}

/**
 * Mark a class as a controller (see `@Controller` of `@chojs/core`): its
 * methods marked with `@Subscribe` are message handlers, under its `topic`.
 *
 * @param options The controller's `dependencies` and its `topic`.
 * @returns The class decorator.
 * @throws {ChoError} When an option is unknown or invalid, or when the class
 *   already has a DI decorator.
 *
 * @example
 * ```ts
 * @Controller({ topic: "orders", dependencies: [Mailer] })
 * class OrdersController {
 *   constructor(readonly mailer: Mailer) {}
 * }
 * ```
 */
export function Controller<const D extends readonly Dependency[] = []>(
  options: MessageControllerOptions<D> = {},
): ChoInjectableDecorator<NoInfer<D>> {
  assert_known_options("@Controller()", options, ["dependencies", "topic"]);
  return CoreController<TopicOption, D>(options);
}

/**
 * Mark a method as the handler of the messages of a topic.
 *
 * The method receives the `ChoMessageContext` of each message. When it
 * returns, the message is handled, and what it returns is ignored. When it
 * throws, the error goes to the nearest error handler (`@Catch`), and without
 * one the message failed: the broker adapter does what its broker does with
 * such a message.
 *
 * A handler handles one topic, and a topic has one handler. The decorator
 * works with both decorator implementations (TC39, and legacy / Bun), and
 * checks, when the class is defined, what would otherwise be silently lost:
 * the topic must be valid, the method must be one the graph builder collects
 * (public, not static, with a string name), and it can have only one
 * `@Subscribe`.
 *
 * @param topic The topic of the handler, relative to its controller:
 *   segments of letters, digits, `_` and `-`, separated by `.`. `""` is the
 *   controller's own topic. There are no wildcards.
 * @returns A method decorator.
 * @throws {ChoError} When the topic is invalid, or when the method already has a
 *   `@Subscribe`.
 * @throws {ChoError} When the decorated member is not a public, non-static,
 *   string-named method.
 *
 * @example
 * ```ts
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   // the topic orders.created
 *   @Subscribe("created")
 *   created(ctx: ChoMessageContext) {
 *     console.log(ctx.key, ctx.json());
 *   }
 * }
 * ```
 */
export function Subscribe(topic: string): ChoMethodDecorator {
  return function (target, context, descriptor) {
    const decorator = "@Subscribe()";
    const decorated = decorated_method(decorator, target, context, descriptor);
    const of = `method ${String(decorated.name)}`;
    if (typeof decorated.name !== "string") {
      throw message_error(
        "CHO_MESSAGE_INVALID_TARGET",
        `${decorator} cannot decorate ${of}: a handler must have a string name`,
      );
    }
    if (decorated.private) {
      throw message_error(
        "CHO_MESSAGE_INVALID_TARGET",
        `${decorator} cannot decorate private ${of}: a handler must be public`,
      );
    }
    if (decorated.static) {
      throw message_error(
        "CHO_MESSAGE_INVALID_TARGET",
        `${decorator} cannot decorate static ${of}: a handler must not be static`,
      );
    }
    normalize_topic(topic, `${decorator} on ${of}`);
    const previous = subscription(read_metadata_object(decorated.meta) ?? {});
    if (previous) {
      throw message_error(
        "CHO_MESSAGE_DUPLICATE_DECORATOR",
        `Cannot add ${decorator} to ${of}: it already handles ${
          JSON.stringify(previous.topic)
        }. A method can have one ${decorator}.`,
      );
    }
    add_to_metadata_object(decorated.meta, {
      [SUBSCRIBE]: Object.freeze({ topic } satisfies Subscription),
    });
  };
}

/**
 * Declare middlewares for a feature module, a controller or a handler.
 *
 * A message runs the feature's middlewares, then the controller's, then the
 * handler's. The decorator can be applied several times: the middlewares are
 * kept in source order, top decorator first.
 *
 * @param middlewares The middlewares, in the order they run: functions
 *   `(ctx, next)`, or classes with a `handle(ctx, next)` method, created by
 *   the injector in the feature module's scope.
 * @returns A class or method decorator.
 * @throws {ChoError} When applied to anything other than a class or a method.
 * @throws {ChoError} When a middleware is not a function or a class.
 *
 * @example
 * ```ts
 * const log: ChoMessageMiddlewareFn = async (ctx, next) => {
 *   console.log("in", ctx.topic);
 *   await next();
 *   console.log("done", ctx.topic);
 * };
 *
 * @Middlewares(log)
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   @Subscribe("created")
 *   created() {}
 * }
 * ```
 */
export function Middlewares(
  ...middlewares: ChoMessageMiddleware[]
): ChoClassOrMethodDecorator {
  return (target, context, descriptor) => {
    const meta = decorated_target(
      "@Middlewares()",
      target,
      context,
      descriptor,
    );
    set_middlewares(meta, middlewares);
  };
}

/**
 * Declare the error handler of a feature module, a controller or a handler.
 *
 * An error thrown by a handler or a middleware goes to the nearest one: the
 * handler's, else the controller's, else the feature's. It settles the
 * message as handled by returning `true`; when it returns anything else, or
 * nothing, the message failed. A class or method has at most one `@Catch`.
 *
 * @param handler A function `(error, ctx)`, or a class with a
 *   `handle(error, ctx)` method, created by the injector in the feature
 *   module's scope.
 * @returns A class or method decorator.
 * @throws {ChoError} When applied to anything other than a class or a method.
 * @throws {ChoError} When `handler` is not a function or a class, or when the
 *   class or method already has an error handler.
 *
 * @example
 * ```ts
 * // a message that is not JSON is dropped; any other error fails it
 * @Catch((error) => error instanceof SyntaxError)
 * @Controller({ topic: "orders" })
 * class OrdersController {}
 * ```
 */
export function Catch(
  handler: ChoMessageErrorHandler,
): ChoClassOrMethodDecorator {
  return (target, context, descriptor) => {
    const meta = decorated_target("@Catch()", target, context, descriptor);
    set_error_handler(meta, handler);
  };
}

/**
 * Declare the arguments of a handler.
 *
 * Standard decorators cannot decorate a parameter, so the arguments are
 * listed on the method, in the order of its parameters. The handler is then
 * called with the value of each argument, and with the context last:
 * `handler(...values, ctx)`. A handler without `@Args` receives the context
 * alone.
 *
 * An argument is made by `Value`, `Key` or `Header`, or is any function
 * `(ctx) => value`. The parameters of the method are checked against the
 * arguments at compile time.
 *
 * - The decorator goes above or below `@Subscribe`.
 * - A method has one `@Args`. An override that declares it replaces the
 *   arguments it inherits; one that does not keeps them.
 * - The arguments are evaluated in order, after the middlewares of the route
 *   and just before the handler.
 * - A validator of an argument is run when `validate()` is among the
 *   middlewares of the handler, of its controller or of its feature module.
 *
 * @typeParam A The arguments.
 * @param args The arguments, in the order of the parameters of the method.
 * @returns A method decorator.
 * @throws {ChoError} When an argument is not a function, or when the
 *   decorated member is not a public, non-static, string-named method.
 * @throws {ChoError} When the method already has `@Args`.
 *
 * @example
 * ```ts
 * @Middlewares(validate())
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   @Subscribe("created")
 *   @Args(Value(Order), Header("tenant"))
 *   created(order: Order, tenant: string | undefined, ctx: ChoMessageContext) {
 *     return this.store.of(tenant).add(order);
 *   }
 * }
 * ```
 */
export function Args<const A extends readonly ChoMessageArg[]>(
  ...args: A
): ChoMessageArgsDecorator<ChoMessageArgValues<A>> {
  const decorate: ChoMethodDecorator = (target, context, descriptor) => {
    const { name } = decorated_method("@Args()", target, context, descriptor);
    const of = `method ${String(name)}`;
    // Rejects a static, private or symbol-named method: its record would
    // never be read.
    const meta = decorated_target("@Args()", target, context, descriptor);
    args.forEach((arg, index) => {
      if (typeof arg !== "function") {
        throw message_error(
          "CHO_MESSAGE_INVALID_ARGUMENT",
          `@Args() on ${of}: argument ${
            index + 1
          } must be made with Value, Key or Header, or be a function, got ${
            describe(arg)
          }`,
        );
      }
    });
    if (handler_args(read_metadata_object(meta) ?? {})) {
      throw message_error(
        "CHO_MESSAGE_DUPLICATE_DECORATOR",
        `Cannot add @Args() to ${of}: it already has one.`,
      );
    }
    add_to_metadata_object(meta, {
      [ARGS]: Object.freeze(
        { list: Object.freeze([...args]) } satisfies HandlerArgs,
      ),
    });
  };
  return decorate as ChoMessageArgsDecorator<ChoMessageArgValues<A>>;
}
