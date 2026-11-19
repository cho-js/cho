/**
 * The functions an application gives to `@chojs/web`: route handlers,
 * middlewares and error handlers.
 *
 * @module
 */

import type { ChoIssue, ChoValidator } from "@chojs/core";
import type { Ctr } from "@chojs/core/di";
import type { ChoWebContext } from "./context.ts";

/**
 * A route handler: a controller method marked with `@Get`, `@Post`, ...
 *
 * What it returns (or resolves to) is the response: a `Response` is sent as
 * is, `undefined` answers `204 No Content`, a body the platform knows (a
 * string, bytes, a `Blob`, a `ReadableStream`, a form) is sent as it is, and
 * anything else is sent as JSON.
 */
export type ChoWebHandler = (ctx: ChoWebContext) => unknown;

/** Runs the rest of the chain, and resolves to its response. */
export type ChoWebNext = () => Promise<Response>;

/**
 * A middleware function. It wraps the rest of the chain (the next
 * middlewares, then the handler):
 *
 * - `next()` runs the rest of the chain and resolves to its `Response`;
 * - returning a `Response` answers the request with it, whether `next()` was
 *   called (to replace the response) or not (to answer early);
 * - returning nothing after calling `next()` passes the response on.
 *
 * @example
 * ```ts
 * const timing: ChoWebMiddlewareFn = async (ctx, next) => {
 *   const start = Date.now();
 *   const res = await next();
 *   res.headers.set("x-time", `${Date.now() - start}ms`);
 *   return res;
 * };
 *
 * const auth: ChoWebMiddlewareFn = (ctx, next) =>
 *   ctx.req.headers.has("authorization")
 *     ? next()
 *     : new Response("unauthorized", { status: 401 });
 * ```
 */
export type ChoWebMiddlewareFn = (
  ctx: ChoWebContext,
  next: ChoWebNext,
) => Response | void | Promise<Response | void>;

/**
 * A middleware, as given to `@Middlewares`: a function, or a class with a
 * `handle(ctx, next)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoWebMiddleware =
  | ChoWebMiddlewareFn
  | Ctr<{ handle: ChoWebMiddlewareFn }>;

/**
 * An error handler function. What it returns is the response, converted like
 * a handler's result, with one difference: returning nothing is not a
 * response. The error is then still unhandled, and goes on to the HTTP
 * runtime (a `500`), so a handler that only logs does not turn a failed
 * request into a success.
 *
 * @example
 * ```ts
 * const on_error: ChoWebErrorHandlerFn = (error, ctx) =>
 *   Response.json({ error: String(error), path: ctx.url.pathname }, { status: 500 });
 * ```
 */
export type ChoWebErrorHandlerFn = (
  error: unknown,
  ctx: ChoWebContext,
) => unknown;

/**
 * An error handler, as given to `@Catch`: a function, or a class with a
 * `handle(error, ctx)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoWebErrorHandler =
  | ChoWebErrorHandlerFn
  | Ctr<{ handle: ChoWebErrorHandlerFn }>;

/** Where an argument made by `Param`, `Query`, `Header`, `Body` or `Form` reads from. */
export type ChoWebArgSource = "param" | "query" | "header" | "body" | "form";

/**
 * What is known about an argument made by `Param`, `Query`, `Header`, `Body`
 * or `Form`: enough to describe it in an OpenAPI document.
 */
export type ChoWebArgInfo = {
  /** Where the value is read from. */
  readonly source: ChoWebArgSource;
  /** The key of the source, when the argument is one key of it. */
  readonly key?: string;
  /** The validator of the argument, when it has one: its schema. */
  readonly validator?: ChoValidator;
};

/**
 * An argument of a handler, as given to `@Args`: a function that takes the
 * context of the request and gives the value, now or as a promise.
 *
 * `Param`, `Query`, `Header`, `Body` and `Form` make one, with its `info`. Any
 * other function of that shape is an argument too.
 *
 * @typeParam T The value the handler receives.
 *
 * @example
 * ```ts
 * const CurrentUser: ChoWebArg<User> = (ctx) => ctx.state.get("user") as User;
 * ```
 */
export type ChoWebArg<T = unknown> =
  & ((ctx: ChoWebContext) => T | Promise<T>)
  & {
    /** What the argument reads, when one of the five functions made it. */
    readonly info?: ChoWebArgInfo;
  };

/**
 * The values of a list of arguments: what a handler receives for them, in
 * order.
 *
 * @typeParam A The arguments, as given to `@Args`.
 */
export type ChoWebArgValues<A extends readonly ChoWebArg[]> = {
  -readonly [K in keyof A]: Awaited<ReturnType<A[K]>>;
};

/**
 * The decorator `@Args` returns. It only accepts a method whose parameters
 * take the values of the arguments, in order, and then the context: a handler
 * that expects something else does not compile.
 *
 * It has both decorator call shapes: standard (TC39) `(method, context)`, and
 * legacy / Bun `(prototype, name, descriptor)`.
 *
 * @typeParam P The values of the arguments.
 */
export type ChoWebArgsDecorator<P extends unknown[]> = {
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: [...P, ChoWebContext]) => unknown>(
    method: M,
    context: ClassMethodDecoratorContext,
  ): void;
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: [...P, ChoWebContext]) => unknown>(
    target: object,
    name: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): void;
};

/**
 * A server-sent event, as an `@Sse` handler yields it.
 *
 * @typeParam T The data of the event.
 *
 * @example
 * ```ts
 * const event: ChoWebSseEvent<Order> = { event: "order", id: "7", data: order };
 * ```
 */
export type ChoWebSseEvent<T = unknown> = {
  /**
   * The data of the event. A string is sent as it is, one `data:` line for
   * each of its lines; anything else is sent as JSON.
   */
  data: T;
  /**
   * The name of the event, for `addEventListener(name)` on the client.
   * Default: none, which makes it a `message` event.
   */
  event?: string;
  /**
   * The id of the event. A client that reconnects sends the last one it got,
   * in the `Last-Event-ID` header. Default: none.
   */
  id?: string;
  /**
   * How long the client waits before it reconnects, in milliseconds. Default:
   * none, which leaves it to the client.
   */
  retry?: number;
};

/** The HTTP methods an `@Sse` handler can answer. */
export type ChoWebSseMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** The options of `@Sse`. */
export type ChoWebSseOptions = {
  /**
   * The HTTP method of the route. Default: `"GET"`, the only one a browser's
   * `EventSource` sends; a stream on another method is read with `fetch`.
   */
  method?: ChoWebSseMethod;
  /**
   * Send a comment line, which clients ignore, whenever this many
   * milliseconds pass with nothing sent, so that a proxy does not close an
   * idle connection. Default: none.
   */
  keepAlive?: number;
};

/**
 * What an `@Sse` handler returns, now or as a promise: the events, as an
 * async iterable (what an `async *` method returns), or a `Response`, to
 * answer without a stream.
 */
export type ChoWebSseResult =
  | AsyncIterable<ChoWebSseEvent | string>
  | Response;

/**
 * The decorator `@Sse` returns. It only accepts a method that returns the
 * events of the stream (see {@link ChoWebSseResult}): a handler that returns
 * something else does not compile.
 *
 * It has both decorator call shapes: standard (TC39) `(method, context)`, and
 * legacy / Bun `(prototype, name, descriptor)`.
 */
export type ChoWebSseDecorator = {
  <
    // deno-lint-ignore no-explicit-any
    M extends (this: any, ...args: any[]) =>
      | ChoWebSseResult
      | Promise<ChoWebSseResult>,
  >(
    method: M,
    context: ClassMethodDecoratorContext,
  ): void;
  <
    // deno-lint-ignore no-explicit-any
    M extends (this: any, ...args: any[]) =>
      | ChoWebSseResult
      | Promise<ChoWebSseResult>,
  >(
    target: object,
    name: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): void;
};

/** What failed the validation of a request: given to `onInvalid`. */
export type ChoWebInvalid = {
  /** The source of the argument that is not valid. */
  readonly source: ChoWebArgSource;
  /** Its key, when the argument is one key of the source. */
  readonly key?: string;
  /**
   * What is not valid: one issue at least. The issues of the validator, or
   * one issue with the message of what was thrown.
   */
  readonly issues: readonly ChoIssue[];
  /**
   * What was thrown, when something was: by the `parse` method of a
   * validator, or by a body that cannot be parsed. A Standard Schema throws
   * nothing for a value that is not valid, so it is not there.
   */
  readonly error?: unknown;
};

/** The options of `validate()`. */
export type ChoWebValidateOptions = {
  /**
   * Answer a request that is not valid. What it returns is the response,
   * converted like the result of a handler. Default: `400`, with a JSON body
   * of `error`, `source`, `key` and `issues`.
   */
  onInvalid?: (invalid: ChoWebInvalid, ctx: ChoWebContext) => unknown;
};

/** A response of a handler, as documented with `@Doc`. */
export type ChoWebDocResponse = {
  /** What the response means. */
  readonly description?: string;
  /** The schema of its body: a validator. */
  readonly schema?: ChoValidator;
  /** The media type of its body. Default: `application/json`. */
  readonly contentType?: string;
};

/**
 * What a handler requires of a request, for the documentation: the name of a
 * security scheme, and the scopes it needs (an empty list when it has none).
 * It is the Security Requirement Object of OpenAPI.
 *
 * @example
 * ```ts
 * const admin: ChoWebDocSecurity = { oauth: ["admin"] };
 * ```
 */
export type ChoWebDocSecurity = Readonly<Record<string, readonly string[]>>;

/**
 * The options of `@Doc`: what the code cannot tell about a handler, a
 * controller or a feature module, for the documentation of the application.
 */
export type ChoWebDoc = {
  /** One line about the operation. On a handler only. */
  readonly summary?: string;
  /** A longer text. */
  readonly description?: string;
  /** The tags of the handlers under it. */
  readonly tags?: readonly string[];
  /** Whether it should no longer be used. */
  readonly deprecated?: boolean;
  /** The responses, by status. On a handler only. */
  readonly responses?: Readonly<Record<number, ChoWebDocResponse>>;
  /** Whether it is left out of the documentation. */
  readonly hidden?: boolean;
  /**
   * The id of the operation. On a handler only. Default, for what generates
   * the documentation: the controller and the method, `UsersController.get`.
   */
  readonly operationId?: string;
  /**
   * What the handlers under it require: any one of the listed requirements.
   * The nearest one wins (the handler's, then the controller's, then the
   * feature's), and an empty list says that nothing is required. It only
   * documents what a middleware enforces.
   */
  readonly security?: readonly ChoWebDocSecurity[];
};

/**
 * A WebSocket of the application: what the methods marked with `@WsOpen`,
 * `@WsMessage` and `@WsClose` receive, last.
 *
 * It is one object for one connection, for its whole life, so it can be kept
 * in a `Set` or a `Map` to send to the sockets of a room.
 *
 * @example
 * ```ts
 * @WsMessage()
 * message(data: string | Uint8Array, socket: ChoWebSocket) {
 *   for (const other of this.rooms.of(socket.ctx.params.room)) {
 *     if (other !== socket) other.send(data);
 *   }
 * }
 * ```
 */
export type ChoWebSocket = {
  /**
   * The context of the request that was upgraded: its `params`, its `url`,
   * the headers of its `req`, and its `state`, where a middleware put what
   * it found (the user, say). A controller is one instance for every
   * connection, so what belongs to one connection is kept here, in
   * `ctx.state`, and not on the controller.
   */
  readonly ctx: ChoWebContext;
  /** Whether the socket is open: `false` once either side closed it. */
  readonly open: boolean;
  /**
   * Send a message, as a returned value is sent: a string as a text
   * message, bytes as a binary message, anything else as JSON, and nothing
   * for `undefined`. On a socket that is not open it does nothing.
   *
   * @param data What to send.
   * @throws {ChoError} `CHO_WEB_INVALID_SOCKET_RESULT` for a value that has
   *   no JSON.
   */
  send(data: unknown): void;
  /**
   * Close the socket. The method marked with `@WsClose` runs with this code
   * and this reason. On a socket that is not open it does nothing.
   *
   * @param code The close code. Default: `1000`.
   * @param reason The reason, a short text. Default: none.
   */
  close(code?: number, reason?: string): void;
  /**
   * The socket of the runtime: a `WebSocket` on Deno and on Cloudflare
   * Workers, a `ServerWebSocket` on Bun, and the connection of `node:http`
   * on Node.js.
   */
  readonly native: unknown;
};

/**
 * What an upgraded connection can do, given by the code that upgraded it to
 * {@link ChoWebUpgrade.accept}: a runtime, or an adapter.
 */
export type ChoWebSocketIo = {
  /** Send a text message (a string) or a binary one (bytes). */
  send(data: string | Uint8Array): void;
  /** Close the connection, with a close code and a reason. */
  close(code: number, reason: string): void;
  /** The socket of the runtime: `ChoWebSocket.native`. */
  readonly native: unknown;
};

/**
 * Where the code that upgraded a connection gives what the connection
 * receives: what {@link ChoWebUpgrade.accept} returns.
 */
export type ChoWebSocketEvents = {
  /** A message arrived: text as a string, binary as bytes. */
  message(data: string | Uint8Array): void;
  /**
   * The connection is closed. Call it once, whoever closed it, with `1006`
   * for a connection that was cut.
   */
  closed(code: number, reason: string): void;
};

/**
 * An upgrade a route accepted: what `ChoWeb.upgrade` resolves with. It is for
 * the code that holds the connection: `serve`, or an adapter with a server
 * of its own.
 *
 * @example
 * ```ts
 * const upgrade = await app.upgrade(request);
 * if (upgrade instanceof Response) return upgrade; // refused
 * const socket = my_runtime.upgrade(request, upgrade.headers);
 * const events = upgrade.accept({
 *   send: (data) => socket.send(data),
 *   close: (code, reason) => socket.close(code, reason),
 *   native: socket,
 * });
 * socket.on("message", (data) => events.message(data));
 * socket.on("close", (code, reason) => events.closed(code, reason));
 * ```
 */
export type ChoWebUpgrade = {
  /**
   * The headers the middlewares of the route added to the answer, to send
   * with the `101` where the runtime takes headers.
   */
  readonly headers: Headers;
  /**
   * Start the socket, once the connection is upgraded: the first message is
   * sent, and the method marked with `@WsOpen` runs. Call it once.
   *
   * @param io What the connection can do.
   * @returns Where to give what the connection receives.
   */
  accept(io: ChoWebSocketIo): ChoWebSocketEvents;
};

/**
 * The decorator `@WsOpen` returns. It only accepts a method that takes the
 * socket, or nothing.
 *
 * It has both decorator call shapes: standard (TC39) `(method, context)`, and
 * legacy / Bun `(prototype, name, descriptor)`.
 */
export type ChoWebWsOpenDecorator = ChoWebWsEventDecorator<
  [socket: ChoWebSocket]
>;

/**
 * The decorator `@WsMessage` returns. It only accepts a method that takes
 * the message, a string or bytes, and then the socket.
 */
export type ChoWebWsMessageDecorator = ChoWebWsEventDecorator<
  [data: string | Uint8Array, socket: ChoWebSocket]
>;

/**
 * The decorator `@WsClose` returns. It only accepts a method that takes the
 * close code, the reason, and then the socket.
 */
export type ChoWebWsCloseDecorator = ChoWebWsEventDecorator<
  [code: number, reason: string, socket: ChoWebSocket]
>;

/**
 * A decorator of a method that handles an event of a socket: the method is
 * called with `Args`, and can take fewer of them.
 *
 * @typeParam Args What the method is called with.
 */
export type ChoWebWsEventDecorator<Args extends unknown[]> = {
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: Args) => unknown>(
    method: M,
    context: ClassMethodDecoratorContext,
  ): void;
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: Args) => unknown>(
    target: object,
    name: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): void;
};
