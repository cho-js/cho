/**
 * @chojs/message — applications that handle the messages of a broker, on top
 * of `@chojs/core`.
 *
 * Controllers declare message handlers with `@Subscribe`, and
 * {@link ChoMessage} gives their topics to a linker from a broker adapter
 * (such as `KafkaLinker` from `@chojs/vendor-kafka`), which subscribes to
 * them. `@Middlewares` and `@Catch` declare middlewares and error handlers;
 * `@Controller`, `@Module` and `@Injectable` come from `@chojs/core`, and so
 * do `token` and `provider`, to declare values that are not classes: an
 * application imports everything from `@chojs/message`.
 *
 * Handlers, middlewares and error handlers receive a
 * {@link ChoMessageContext}, which holds the message as plain data:
 * application code does not depend on the client library of the broker.
 *
 * Topics have up to four levels, joined with `.`: the global `prefix` of
 * {@link ChoMessage.create}, the `topic` of the feature module (a module that
 * declares controllers), the `topic` of the controller, and the topic of the
 * handler.
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
 * // Without a linker, messages are delivered by hand.
 * const app = await ChoMessage.create(App);
 * await app.handle("orders.created", { key: "42", value: '{"id":"42"}' });
 * await app.close();
 * ```
 *
 * @module
 */

// What an application needs from the core, so that it only imports
// `@chojs/message`: the `@Injectable` decorator, and `token` and `provider`
// to declare values that are not classes (and the `overrides` of tests).
export {
  configure,
  type ConfigureOptions,
  type ControllerOptions,
  Injectable,
  type InjectableOptions,
  type InjectionToken,
  type ModuleOptions,
  type Provider,
  provider,
  token,
  type WithDependencies,
} from "@chojs/core/di";
// What `ChoMessage` exposes: its routes, its graph and its linked
// application. They are also in `@chojs/message/linker` and
// `@chojs/message/graph`, for adapters.
export type {
  Delivery,
  Linked,
  Linker,
  Reply,
  RequestOptions,
  Route,
  Sender,
} from "./linker.ts";
export { ChoMessageReply, type ChoMessageReplyOptions } from "./reply.ts";
export {
  type ChoMessageContractDecorator,
  type ChoMessageContractResult,
  type Contract,
  contract,
} from "./contract.ts";
export {
  isReplyError,
  ReplyError,
  type ReplyErrorOptions,
} from "./reply-error.ts";
export {
  ChoMessageClient,
  type ChoMessageClientOptions,
  type ChoMessageRequestOptions,
  type ChoMessageSendOptions,
  type ChoMessageSent,
  type LocalApplication,
  localSender,
} from "./client.ts";
export type {
  AppRef,
  ControllerRef,
  ErrorHandlerRef,
  FeatureRef,
  MethodRef,
  NodeRef,
} from "./graph.ts";
export * from "./decorators.ts";
export { Header, Key, Value } from "./args.ts";
export { validate } from "./validate.ts";
export * from "./message.ts";
export type { ChoMessageContext } from "./context.ts";
// The errors of the framework, with their codes.
export { type ChoCoreErrorCode, ChoError, isChoError } from "@chojs/core";
export type { ChoMessageErrorCode } from "./errors.ts";
export type * from "./types.ts";
