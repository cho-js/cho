/**
 * Linkers connect the routes of an application to a broker, such as Kafka.
 * Each broker adapter, such as `@chojs/vendor-kafka`, implements
 * {@link Linker} and {@link Linked}.
 *
 * A linker does no plumbing: every {@link Route} is ready to call.
 * `@chojs/message` creates the context of a message and runs the middlewares,
 * the handler and the error handler; the adapter only subscribes to the topic
 * of each route, gives it its messages, and acknowledges the ones that were
 * handled.
 *
 * `@chojs/message` does not depend on any adapter: the application passes the
 * linker to `ChoMessage.create`, and the adapters depend on `@chojs/message`.
 *
 * @module
 */

/** One message, as plain data: what an adapter gives to a route. */
export type Delivery = {
  /**
   * The value of the message: its bytes, or a string, which is encoded as
   * UTF-8. A message without a value has none, or `null`.
   */
  readonly value?: Uint8Array | string | null | undefined;
  /** The key of the message, when it has one. */
  readonly key?: string | undefined;
  /** The headers of the message, when it has some. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
};

/** A route of the application: a topic, ready to subscribe to. */
export type Route = {
  /** The full topic, global prefix included: `"staging.orders.created"`. */
  readonly topic: string;
  /** Where the route is declared, for logs: `"OrdersController.created"`. */
  readonly name: string;
  /**
   * Handle one message of the topic. It runs the route's middlewares, its
   * handler and, on an error, its error handler.
   *
   * @param delivery The message.
   * @param native The adapter's own message, if any; handlers see it as
   *   `ctx.native`.
   * @returns A promise that resolves when the message is handled: the adapter
   *   acknowledges it. It rejects, with the error, when the message failed:
   *   the adapter does what its broker does with such a message.
   */
  handle(delivery: Delivery, native?: unknown): Promise<void>;
};

/**
 * An application linked by a {@link Linker}: the adapter's own object, and
 * what connects it to the broker.
 *
 * @typeParam T The adapter's own object, such as the client of the broker.
 *
 * Adapters can return a plain object, or an instance of their own class.
 */
export interface Linked<T> {
  /** The adapter's own object. */
  readonly instance: T;

  /**
   * Connect to the broker, and subscribe to the topic of each route.
   *
   * @returns A promise that resolves once the application is subscribed, and
   *   rejects when the broker cannot be reached.
   */
  start(): Promise<void>;

  /**
   * Stop receiving messages, wait for the ones that are being handled, and
   * disconnect.
   */
  stop(): Promise<void>;
}

/**
 * Connects the routes of an application to a broker.
 *
 * @typeParam T The adapter's own object, such as the client of the broker.
 *
 * @example
 * ```ts
 * class MyLinker implements Linker<MyClient> {
 *   link(routes: readonly Route[]): Linked<MyClient> {
 *     const client = new MyClient();
 *     return {
 *       instance: client,
 *       start: async () => {
 *         await client.connect();
 *         for (const route of routes) {
 *           await client.subscribe(route.topic, async (message) => {
 *             try {
 *               await route.handle({ value: message.data }, message);
 *               await message.ack();
 *             } catch {
 *               await message.retryLater();
 *             }
 *           });
 *         }
 *       },
 *       stop: () => client.close(),
 *     };
 *   }
 * }
 *
 * const app = await ChoMessage.create(AppModule, { linker: new MyLinker() });
 * ```
 */
export interface Linker<T> {
  /**
   * Prepare the routes for a broker. It does no I/O: `ChoMessage.create`
   * calls it, and must not need a broker. {@link Linked.start} connects.
   *
   * @param routes The routes of the application, in declaration order.
   * @returns The linked application.
   */
  link(routes: readonly Route[]): Linked<T>;
}
