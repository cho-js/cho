/**
 * The decorators of `@chojs/message`.
 *
 * - `@Subscribe` marks the message handlers of a controller. It writes the
 *   handler's topic on the decorated method, under the private `SUBSCRIBE`
 *   key (`keys.ts`), which the graph builder reads (see `build-graph.ts`).
 * - `@Args` declares the arguments of a handler. It writes them under the
 *   private `ARGS` key.
 * - `@Doc` declares what the documentation of the application says about a
 *   handler, a controller or a feature module, under the private `DOC` key.
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
import { describe, is_validator } from "@chojs/core/utils";
import { Value } from "./args.ts";
import {
  type ChoMessageContractDecorator,
  type Contract,
  is_contract,
} from "./contract.ts";
import {
  ARGS,
  DOC,
  doc_of,
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
  ChoMessageDoc,
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
 * Given a contract in place of a topic, the handler takes its topic, its
 * argument and its types from it: see the second signature.
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
export function Subscribe(topic: string): ChoMethodDecorator;
/**
 * Mark a controller method as the handler of a contract.
 *
 * It is `@Subscribe(topic)` and `@Args(Value(request))` in one. The handler
 * is called with the value of the message, then the context:
 * `handler(request, ctx)`. Its parameter, and what it returns, are checked
 * against the contract at compile time.
 *
 * - The topic of the contract is the whole topic of the handler, without the
 *   prefix of the application. The topics of the module and of the
 *   controller are not added to it: they must be the start of it, and the
 *   application is not created otherwise.
 * - The request goes through its validator when `validate()` is on the
 *   route, as any argument does.
 * - What the handler returns is sent as JSON, a string too: a contract
 *   speaks JSON both ways. A `ChoMessageReply` gives the headers.
 * - The handler has no `@Args` of its own: it reads anything else from the
 *   context.
 *
 * @typeParam Request What the handler receives.
 * @typeParam Reply What who asks receives.
 * @typeParam Sent What who asks sends.
 * @typeParam Returned What the handler returns: `Reply`, unless the
 *   validator of the reply converts.
 * @param contract The contract, made by `contract()`.
 * @returns A method decorator.
 * @throws {ChoError} When the method already has `@Subscribe` or `@Args`, or
 *   is not a public, non-static, string-named method.
 *
 * @example
 * ```ts
 * @Middlewares(validate())
 * @Controller({ topic: "shop.orders" })
 * class OrdersController {
 *   // the topic shop.orders.price
 *   @Subscribe(GetPrice)
 *   price(request: { id: number }, ctx: ChoMessageContext) {
 *     return { id: request.id, price: 42 };
 *   }
 * }
 * ```
 */
export function Subscribe<Request, Reply, Sent, Returned>(
  contract: Contract<Request, Reply, Sent, Returned>,
): ChoMessageContractDecorator<Request, Returned>;
export function Subscribe(
  given: string | Contract<unknown, unknown>,
): ChoMethodDecorator {
  // What is neither a topic nor a contract is reported as a topic that is
  // not valid.
  const contract = is_contract(given) ? given : undefined;
  const topic = contract ? contract.topic : given as string;
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
    if (!contract) {
      add_to_metadata_object(decorated.meta, {
        [SUBSCRIBE]: Object.freeze({ topic } satisfies Subscription),
      });
      return;
    }
    if (handler_args(read_metadata_object(decorated.meta) ?? {})) {
      throw message_error(
        "CHO_MESSAGE_DUPLICATE_DECORATOR",
        `Cannot add ${decorator} of a contract to ${of}: it has @Args(). A handler of a contract receives its request, then the context.`,
      );
    }
    add_to_metadata_object(decorated.meta, {
      [SUBSCRIBE]: Object.freeze({ topic, contract } satisfies Subscription),
      [ARGS]: Object.freeze(
        {
          list: Object.freeze([
            contract.request ? Value(contract.request) : Value(),
          ]),
        } satisfies HandlerArgs,
      ),
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
    const record = read_metadata_object(meta) ?? {};
    if (subscription(record)?.contract) {
      throw message_error(
        "CHO_MESSAGE_DUPLICATE_DECORATOR",
        `Cannot add @Args() to ${of}: it is the handler of a contract, and receives its request, then the context.`,
      );
    }
    if (handler_args(record)) {
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

/** The options of `@Doc` that are for a handler only. */
const HANDLER_DOC = ["summary", "description", "reply", "operationId"] as const;

/**
 * Check the options of `@Doc` that have a shape of their own.
 *
 * @throws {ChoError} When `operationId` or `reply` is not what it should be.
 */
function assert_doc(options: ChoMessageDoc): void {
  const { operationId, reply } = options;
  if (
    operationId !== undefined &&
    (typeof operationId !== "string" || operationId === "")
  ) {
    throw message_error(
      "CHO_MESSAGE_INVALID_OPTION",
      `@Doc(): operationId must be a non-empty string, got ${
        describe(operationId)
      }`,
    );
  }
  if (reply === undefined) {
    return;
  }
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) {
    throw message_error(
      "CHO_MESSAGE_INVALID_OPTION",
      `@Doc(): reply must be an object, such as { description: "The price", schema: Price }, got ${
        describe(reply)
      }`,
    );
  }
  assert_known_options("@Doc(): reply", reply, ["description", "schema"]);
  if (reply.schema !== undefined && !is_validator(reply.schema)) {
    throw message_error(
      "CHO_MESSAGE_INVALID_OPTION",
      `@Doc(): the schema of reply must be a validator (a Standard Schema, or an object with a parse method), got ${
        describe(reply.schema)
      }`,
    );
  }
}

/**
 * Describe a handler, a controller or a feature module for the documentation
 * of the application, such as an AsyncAPI document. It says what the code
 * cannot tell, and changes nothing in how a message is handled.
 *
 * What is declared is exposed on the graph of the application (`app.graph`),
 * as the `doc` of the feature, of the controller and of the handler.
 *
 * @param options The description: `summary`, `description`, `reply` and
 *   `operationId` on a handler; `tags` and `hidden` on a handler, a
 *   controller or a feature module.
 * @returns A class or method decorator.
 * @throws {ChoError} When an option is unknown or invalid, when a handler
 *   option is given on a class, or when the class or the method already has
 *   `@Doc`.
 * @throws {ChoError} When applied to anything other than a class or a
 *   public, non-static, string-named method.
 *
 * @example
 * ```ts
 * @Doc({ tags: ["orders"] })
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   @Doc({
 *     summary: "The price of an order",
 *     reply: { description: "The price, in cents", schema: Price },
 *   })
 *   @Subscribe("price")
 *   @Args(Value(OrderId))
 *   price(order: OrderId) {
 *     return this.prices.of(order.id);
 *   }
 * }
 * ```
 */
export function Doc(options: ChoMessageDoc): ChoClassOrMethodDecorator {
  assert_known_options("@Doc()", options, [
    "description",
    "hidden",
    "operationId",
    "reply",
    "summary",
    "tags",
  ]);
  assert_doc(options);
  return (target, context, descriptor) => {
    const meta = decorated_target("@Doc()", target, context, descriptor);
    let what: string;
    if (
      context === undefined ||
      (typeof context === "object" && context.kind === "class")
    ) {
      what = `class ${describe(target)}`;
      for (const key of HANDLER_DOC) {
        if (key in options) {
          throw message_error(
            "CHO_MESSAGE_INVALID_OPTION",
            `@Doc(): option ${
              JSON.stringify(key)
            } is for a handler, not for a class (${what})`,
          );
        }
      }
    } else {
      const { name } = decorated_method("@Doc()", target, context, descriptor);
      what = `method ${String(name)}`;
    }
    if (doc_of(read_metadata_object(meta) ?? {})) {
      throw message_error(
        "CHO_MESSAGE_DUPLICATE_DECORATOR",
        `Cannot add @Doc() to ${what}: it already has one.`,
      );
    }
    add_to_metadata_object(meta, { [DOC]: Object.freeze({ ...options }) });
  };
}
