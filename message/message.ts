/**
 * The message application: {@link ChoMessage} compiles the topics of a root
 * module and gives them to a {@link Linker}, a broker adapter such as
 * `KafkaLinker` from `@chojs/vendor-kafka`, which subscribes to them.
 *
 * It logs to the `cho:message` debug context (`CHO_DEBUGLOG=cho:message` or
 * `CHO_DEBUG=1`): every topic with its handler, any error that stops the
 * application from being created, and every message that fails.
 *
 * @module
 */

import { message_error } from "./errors.ts";
import {
  assert_known_options,
  type Ctr,
  Injector,
  type Provider,
} from "@chojs/core/di";
import { type Debuglog, debuglog, describe } from "@chojs/core/utils";
import { build_message_graph } from "./build-graph.ts";
import type { AppRef } from "./graph.ts";
import type { Delivery, Linked, Linker, Reply, Route } from "./linker.ts";
import { compile_routes } from "./routes.ts";
import type { ChoMessageErrorHandler, ChoMessageMiddleware } from "./types.ts";

/**
 * Options of {@link ChoMessage.create}. Every option is optional.
 *
 * @typeParam T The adapter's own object, such as the client of the broker.
 *
 * @example
 * ```ts
 * import { KafkaLinker } from "@chojs/vendor-kafka";
 *
 * const app = await ChoMessage.create(AppModule, {
 *   linker: new KafkaLinker({ brokers: ["localhost:9092"], groupId: "shop" }),
 *   prefix: "staging", // every topic starts with staging.
 * });
 * ```
 */
export type ChoMessageOptions<T = unknown> = {
  /**
   * The linker that connects the topics to a broker, such as `KafkaLinker`
   * from `@chojs/vendor-kafka`.
   *
   * Default: none. The application then has no broker: `start()` rejects,
   * and messages are delivered by hand, with `handle()`.
   */
  linker?: Linker<T>;
  /**
   * The global topic prefix, added before every feature topic, such as the
   * name of an environment (`"staging"`). Default: `""`, no prefix.
   */
  prefix?: string;
  /**
   * The error handler of the application: it handles the errors of every
   * handler that no `@Catch` handler covers (the handler's, the controller's
   * and the feature's come first). Like `@Catch`, it takes a function
   * `(error, ctx)`, or a class with a `handle(error, ctx)` method, created by
   * the injector in the scope of the root module. It settles the message as
   * handled by returning `true`; when it returns anything else, or nothing
   * (it only logs, say), the message failed. Default: none.
   *
   * @example
   * ```ts
   * const app = await ChoMessage.create(AppModule, {
   *   linker,
   *   onError: (error, ctx) => {
   *     console.error(ctx.topic, ctx.key, error);
   *   },
   * });
   * ```
   */
  onError?: ChoMessageErrorHandler;
  /**
   * The middlewares of the application: they run for **every** message, in
   * order, before the middlewares of its feature, of its controller and of
   * its handler. Like `@Middlewares`, it takes functions `(ctx, next)`, and
   * classes with a `handle(ctx, next)` method, created by the injector in
   * the scope of the root module. They are middlewares like the others: an
   * error they throw goes to the error handlers, and one that returns
   * without calling `next()` skips the handler.
   *
   * `validate()` is not one of them: it covers the handlers under it, and is
   * declared with `@Middlewares`. Giving it here throws.
   *
   * Default: none.
   *
   * @example
   * ```ts
   * const app = await ChoMessage.create(AppModule, {
   *   linker,
   *   middlewares: [async (ctx, next) => {
   *     const start = performance.now();
   *     await next();
   *     console.log(ctx.topic, `${Math.round(performance.now() - start)}ms`);
   *   }],
   * });
   * ```
   */
  middlewares?: readonly ChoMessageMiddleware[];
  /**
   * Providers that replace the declared providers of the same token, for
   * tests (see `InjectorOptions.overrides` of `@chojs/core`). Default: none.
   */
  overrides?: readonly Provider[];
};

/**
 * Options of {@link ChoMessage.from}: those of {@link ChoMessage.create},
 * without `overrides`, which belong to whoever creates the injector.
 *
 * @typeParam T The adapter's own object, such as the client of the broker.
 */
export type ChoMessageFromOptions<T = unknown> = Omit<
  ChoMessageOptions<T>,
  "overrides"
>;

/** What an application without a linker is linked to: nothing. */
const NOT_LINKED: Linked<undefined> = {
  instance: undefined,
  start: () =>
    Promise.reject(
      message_error(
        "CHO_MESSAGE_NO_LINKER",
        "ChoMessage.start(): the application has no linker. Give ChoMessage.create or ChoMessage.from a linker, such as KafkaLinker",
      ),
    ),
  stop: () => Promise.resolve(),
};

/** What every call gets once the application is closed. */
function closed(): Promise<never> {
  return Promise.reject(
    message_error("CHO_MESSAGE_CLOSED", "The application is closed"),
  );
}

/**
 * A message application, built from a root module.
 *
 * Every module that declares controllers is a feature. The topic of a handler
 * joins up to four levels with `.`, each optional: the global `prefix`, the
 * feature module's `topic`, the controller's `topic` and the topic given to
 * `@Subscribe`. A handler handles one topic, and a topic has one handler.
 *
 * Handlers, middlewares and error handlers receive a `ChoMessageContext`,
 * whatever the broker. A message is handled when its handler returns; it
 * failed when its handler throws and no error handler settles it.
 *
 * @typeParam T The adapter's own object, such as the client of the broker;
 *   `undefined` for an application without a linker.
 *
 * @example
 * ```ts
 * import {
 *   ChoMessage,
 *   type ChoMessageContext,
 *   Controller,
 *   Module,
 *   Subscribe,
 * } from "@chojs/message";
 * import { KafkaLinker } from "@chojs/vendor-kafka";
 *
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   @Subscribe("created") // the topic orders.created
 *   created(ctx: ChoMessageContext) {
 *     console.log(ctx.key, ctx.json());
 *   }
 * }
 *
 * @Module({ controllers: [OrdersController] })
 * class App {}
 *
 * const app = await ChoMessage.create(App, {
 *   linker: new KafkaLinker({ brokers: ["localhost:9092"], groupId: "shop" }),
 * });
 * await app.start();
 * ```
 */
export class ChoMessage<T = unknown> {
  /**
   * The linked application: the adapter's own object (`linked.instance`), and
   * what connects it to the broker. Without a linker, its `instance` is
   * `undefined`.
   */
  readonly linked: Linked<T>;
  /**
   * The topics of the application as a tree: features, controllers and
   * handlers, with their instances, middlewares and error handlers.
   */
  readonly graph: AppRef;
  /**
   * Every topic of the application, in declaration order: its `topic`, the
   * `name` of its handler, and `handle`, which handles one message.
   */
  readonly routes: readonly Route[];
  /**
   * The injector of the application: it holds its instances. Give it to the
   * `from` of another CHO module to build a second application on the same
   * instances. An application made by {@link ChoMessage.create} owns it, and
   * disposes it in {@link ChoMessage.close}; one made by
   * {@link ChoMessage.from} has the injector it was given.
   */
  readonly injector: Injector;
  /** Whether the application created the injector, and so disposes it. */
  readonly #owner: boolean;
  /** The route of each topic. */
  readonly #topics = new Map<string, Route>();
  /** The messages that are being handled. */
  readonly #in_hand = new Set<Promise<unknown>>();
  /** The one start of the application. */
  #start: Promise<void> | undefined;
  /** The one close of the application. */
  #close: Promise<void> | undefined;
  /** Whether no message is accepted any more. */
  #closed = false;

  /**
   * Create a message application from a root module, with an injector of its
   * own.
   *
   * It builds the injector, creates every instance of the application,
   * builds and checks the topics, and gives them to the linker. It does not
   * connect to the broker: {@link ChoMessage.start} does.
   *
   * @typeParam T The adapter's own object, such as the client of the broker.
   * @param app The root module.
   * @param options The application options: the linker, and optionally the
   *   global prefix, the error handler and the overrides.
   * @returns The application.
   * @throws {ChoError} When the module graph is invalid (see `Injector`), when a
   *   topic is invalid or declared twice, when a middleware or an error
   *   handler is invalid or cannot be created, or when an option is unknown.
   *   What was created until then is disposed.
   *
   * @example
   * ```ts
   * const app = await ChoMessage.create(AppModule, { linker });
   * await app.start();
   * ```
   */
  static create<T>(
    app: Ctr,
    options: ChoMessageOptions<T> & { linker: Linker<T> },
  ): Promise<ChoMessage<T>>;
  /**
   * Create a message application without a linker: it has no broker, and its
   * messages are delivered by hand, with {@link ChoMessage.handle}. It is how
   * an application is tested.
   *
   * @param app The root module.
   * @param options The application options, such as the global prefix.
   * @returns The application.
   * @throws {ChoError} As above.
   *
   * @example
   * ```ts
   * const app = await ChoMessage.create(AppModule);
   * await app.handle("orders.created", { value: '{"id":"42"}' });
   * ```
   */
  static create(
    app: Ctr,
    options?: Omit<ChoMessageOptions<undefined>, "linker">,
  ): Promise<ChoMessage<undefined>>;
  static async create<T>(
    app: Ctr,
    options: ChoMessageOptions<T> = {},
  ): Promise<ChoMessage<T | undefined>> {
    // Created here, not when the module is loaded, so it follows `set_env`.
    const log = debuglog("cho:message");
    const done = log.start();
    let injector: Injector | undefined;
    try {
      assert_known_options("ChoMessage.create()", options, [
        "linker",
        "middlewares",
        "onError",
        "overrides",
        "prefix",
      ]);
      injector = new Injector(
        app,
        options.overrides ? { overrides: options.overrides } : {},
      );
      await injector.init();
      const message = await ChoMessage.#build(injector, options, true, log);
      done(`application ${describe(app)} created`);
      return message;
    } catch (error) {
      log.error(`cannot create application ${describe(app)}:`, error);
      // Release what was created before the failure (an open connection,
      // say); the failure to create is the error to report.
      await injector?.dispose().catch((cause) =>
        log.error("cleanup after the failure failed:", cause)
      );
      throw error;
    }
  }

  /**
   * Create a message application on an injector that exists, such as the one
   * of a web application (`web.injector`): the two applications then share
   * one set of instances.
   *
   * It finds the controllers that have `@Subscribe` handlers, resolves them
   * (nothing that exists is created again), and builds and checks the topics,
   * as {@link ChoMessage.create} does.
   *
   * The application does not own the injector: its `close()` stops it, and
   * disposes nothing. Whoever created the injector disposes the instances,
   * after this application is closed.
   *
   * @typeParam T The adapter's own object, such as the client of the broker.
   * @param injector The injector of the other application.
   * @param options The application options: the linker, and optionally the
   *   global prefix and the error handler. There is no `overrides`: they are
   *   given to whoever creates the injector.
   * @returns The application.
   * @throws {ChoError} When `injector` is not an injector.
   * @throws {ChoError} When a topic is invalid or declared twice, when a
   *   middleware or an error handler is invalid or cannot be created, when an
   *   option is unknown, or when the injector is disposed.
   *
   * @example
   * ```ts
   * const web = await ChoWeb.create(AppModule);
   * const messages = await ChoMessage.from(web.injector, { linker });
   *
   * await messages.start();
   * // ... later, in this order:
   * await messages.close(); // stops; disposes nothing
   * await web.close(); //      disposes the instances, once
   * ```
   */
  static from<T>(
    injector: Injector,
    options: ChoMessageFromOptions<T> & { linker: Linker<T> },
  ): Promise<ChoMessage<T>>;
  /**
   * Create a message application without a linker on an injector that
   * exists: its messages are delivered by hand, with
   * {@link ChoMessage.handle}.
   *
   * @param injector The injector of the other application.
   * @param options The application options, such as the global prefix.
   * @returns The application.
   * @throws {ChoError} As above.
   */
  static from(
    injector: Injector,
    options?: Omit<ChoMessageFromOptions<undefined>, "linker">,
  ): Promise<ChoMessage<undefined>>;
  static async from<T>(
    injector: Injector,
    options: ChoMessageFromOptions<T> = {},
  ): Promise<ChoMessage<T | undefined>> {
    const log = debuglog("cho:message");
    const done = log.start();
    try {
      const given = injector as Partial<Injector> | null | undefined;
      if (
        typeof given?.modules !== "function" ||
        typeof given.resolve !== "function"
      ) {
        throw message_error(
          "CHO_MESSAGE_INVALID_INJECTOR",
          `ChoMessage.from(): expected an injector, got ${describe(injector)}`,
        );
      }
      assert_known_options("ChoMessage.from()", options, [
        "linker",
        "middlewares",
        "onError",
        "prefix",
      ]);
      const message = await ChoMessage.#build(injector, options, false, log);
      done("application created on a given injector");
      return message;
    } catch (error) {
      log.error("cannot create the application on the given injector:", error);
      throw error;
    }
  }

  /**
   * Build the application on an injector: the graph, the routes, and the
   * linked application.
   *
   * @param injector The injector.
   * @param options The options of the application.
   * @param owner Whether the application created the injector.
   * @param log The `cho:message` debug logger.
   */
  static async #build<T>(
    injector: Injector,
    options: ChoMessageFromOptions<T>,
    owner: boolean,
    log: Debuglog,
  ): Promise<ChoMessage<T | undefined>> {
    const graph = await build_message_graph(
      injector,
      options.prefix ?? "",
      options.onError,
      options.middlewares,
    );
    const routes = compile_routes(graph, log);
    if (log.enabled) {
      for (const route of routes) {
        log(`${route.topic} -> ${route.name}`);
      }
    }
    return new ChoMessage<T | undefined>(
      options.linker,
      graph,
      routes,
      injector,
      owner,
    );
  }

  /**
   * Create a message application from its parts. Applications are made with
   * {@link ChoMessage.create} or {@link ChoMessage.from}.
   *
   * @param linker The linker that connects the routes to a broker, if any.
   * @param graph The message graph of the application.
   * @param routes The routes of the application.
   * @param injector The injector of the application.
   * @param owner Whether the application created the injector: `close()`
   *   then disposes it. Default: `true`.
   */
  constructor(
    linker: Linker<T> | undefined,
    graph: AppRef,
    routes: readonly Route[],
    injector: Injector,
    owner = true,
  ) {
    this.graph = graph;
    this.injector = injector;
    this.#owner = owner;
    // What the linker calls goes through the application, which knows the
    // messages in hand, and refuses the ones that come after it is closed.
    this.routes = routes.map((route) => ({
      topic: route.topic,
      name: route.name,
      handle: (delivery, native) =>
        this.#track(() => route.handle(delivery, native)),
    }));
    for (const route of this.routes) {
      this.#topics.set(route.topic, route);
    }
    this.linked = linker ? linker.link(this.routes) : NOT_LINKED as Linked<T>;
  }

  /**
   * Run the handling of one message, and remember it until it settles.
   *
   * @param handle Handles the message.
   * @returns What `handle` returns. It rejects once the application is
   *   closed.
   */
  #track<T>(handle: () => Promise<T>): Promise<T> {
    if (this.#closed) {
      return closed();
    }
    const handling = handle();
    this.#in_hand.add(handling);
    const settled = () => {
      this.#in_hand.delete(handling);
    };
    handling.then(settled, settled);
    return handling;
  }

  /**
   * Connect to the broker, and subscribe to every topic of the application.
   * Messages can arrive before it resolves.
   *
   * @returns A promise that resolves once the application is subscribed.
   *   Calling it again returns the same start. It rejects when the broker
   *   cannot be reached, when the application has no linker, and once the
   *   application is closed.
   *
   * @example
   * ```ts
   * const app = await ChoMessage.create(AppModule, { linker });
   * await app.start();
   * ```
   */
  start(): Promise<void> {
    if (this.#close) {
      return closed();
    }
    return this.#start ??= (async () => {
      await this.linked.start();
    })();
  }

  /**
   * Give one message to the handler of a topic, without a broker: the
   * counterpart of calling `app.handler(new Request(…))` in `@chojs/web`. It
   * needs no linker, and no `start()`.
   *
   * @param topic The full topic, global prefix included.
   * @param message The message: its `value` (bytes, or a string), its `key`
   *   and its `headers`, each optional. Default: a message with none of them.
   * @returns A promise that resolves when the message is handled, with its
   *   reply: what the handler returned, as bytes (`reply.value`), or
   *   `undefined` when it returned nothing. It rejects, with the error, when
   *   the message failed, when the topic has no handler, and once the
   *   application is closed.
   *
   * @example
   * ```ts
   * await app.handle("orders.created", {
   *   value: JSON.stringify({ id: "42" }),
   *   key: "42",
   *   headers: { "message-id": "abc" },
   * });
   * ```
   *
   * @example The reply of a handler
   * ```ts
   * const reply = await app.handle("orders.price", { value: "42" });
   * JSON.parse(new TextDecoder().decode(reply?.value)); // { total: 12 }
   * ```
   */
  handle(topic: string, message: Delivery = {}): Promise<Reply | undefined> {
    if (this.#close) {
      return closed();
    }
    const route = this.#topics.get(topic);
    if (!route) {
      return Promise.reject(
        message_error(
          "CHO_MESSAGE_UNKNOWN_TOPIC",
          `ChoMessage.handle(): no handler for the topic ${describe(topic)}`,
        ),
      );
    }
    return route.handle(message);
  }

  /**
   * Stop the application: stop receiving messages, wait for the ones that are
   * being handled, and disconnect. An application made by
   * {@link ChoMessage.create} then disposes its instances, in reverse
   * creation order; one made by {@link ChoMessage.from} disposes nothing.
   *
   * @returns A promise that resolves when the application is stopped. Calling
   *   it again returns the same close. It rejects when the linker cannot
   *   stop, or when an instance cannot be disposed.
   *
   * @example
   * ```ts
   * process.on("SIGTERM", () => app.close());
   * ```
   */
  close(): Promise<void> {
    return this.#close ??= this.#shutdown();
  }

  /** What `close()` does, once. */
  async #shutdown(): Promise<void> {
    try {
      if (this.#start) {
        // A start that is still connecting ends first; one that failed may
        // have left something to stop.
        await this.#start.catch(() => {});
        await this.linked.stop();
      }
    } finally {
      // The linker has stopped: what still comes is refused.
      this.#closed = true;
      await Promise.allSettled([...this.#in_hand]);
      if (this.#owner) {
        await this.injector.dispose();
      }
    }
  }

  /**
   * Stop the application: the same as {@link ChoMessage.close}, for
   * `await using`.
   *
   * @returns A promise that resolves when the application is stopped.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
