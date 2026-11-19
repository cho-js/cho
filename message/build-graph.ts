/**
 * Builds the message graph (see `graph.ts`) of an application from its
 * injector, and validates each topic. Internal to `@chojs/message`:
 * `ChoMessage` calls {@link build_message_graph}; it is not a package export.
 *
 * @module
 */

import { message_error } from "./errors.ts";
import {
  assert_handle,
  type ControllerMetadata,
  type Ctr,
  type Injector,
  type MethodMetadata,
  type ModuleMetadata,
  resolve_handle,
} from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import {
  describe_invalid,
  describe_issues,
  evaluate_args,
  InvalidArgument,
} from "./args.ts";
import type { ChoMessageContext } from "./context.ts";
import {
  AppRef,
  ControllerRef,
  type ErrorHandlerRef,
  FeatureRef,
  MethodRef,
} from "./graph.ts";
import { handler_args, type Subscription, subscription } from "./keys.ts";
import { to_contract_reply } from "./reply.ts";
import { join_topic, normalize_topic } from "./topic.ts";
import type {
  ChoMessageArg,
  ChoMessageErrorHandlerFn,
  ChoMessageHandler,
  ChoMessageMiddlewareFn,
  ChoMessageValidateOptions,
} from "./types.ts";
import { validation_of } from "./validate.ts";

/**
 * Make the handler of a method: what the route calls with the context of a
 * message.
 *
 * @param method The method, bound to its controller.
 * @param args The arguments of the method, as given to `@Args`.
 * @param validation The options of the validation middleware that covers the
 *   handler, or `undefined` when none does.
 * @param contract The name of the handler when it is the handler of a
 *   contract, whose reply is sent as JSON; `undefined` otherwise.
 * @returns The method itself when it has no arguments. Otherwise a function
 *   that evaluates them, and calls the method with their values and then the
 *   context. For a validated handler, an argument that is not valid is given
 *   to `onInvalid`: `true` handles the message with no reply, a value is its
 *   reply, and nothing (or `false`) fails it with
 *   `CHO_MESSAGE_INVALID_MESSAGE`, whose message says the issues. What the
 *   `validate` function of a Standard Schema throws is thrown on: it is an
 *   error of the validator, not a message that is not valid.
 */
function create_handler(
  method: (...args: unknown[]) => unknown,
  args: readonly ChoMessageArg[],
  validation: ChoMessageValidateOptions | undefined,
  contract?: string,
): ChoMessageHandler {
  if (args.length === 0) {
    return method;
  }
  return async (ctx: ChoMessageContext) => {
    let values: unknown[];
    try {
      values = await evaluate_args(args, ctx, validation !== undefined);
    } catch (error) {
      if (!(error instanceof InvalidArgument)) {
        throw error;
      }
      const { invalid } = error;
      const answer = await validation?.onInvalid?.(invalid, ctx);
      // As an error handler: nothing, or `false`, leaves the message failed.
      if (answer === undefined || answer === false) {
        throw message_error(
          "CHO_MESSAGE_INVALID_MESSAGE",
          `Invalid message of ${ctx.topic}: ${
            describe_invalid(invalid)
          } is not valid: ${describe_issues(invalid.issues)}`,
          "error" in invalid ? { cause: invalid.error } : undefined,
        );
      }
      // `true` handles it with no reply. Anything else is the reply.
      return answer === true ? undefined : answer;
    }
    const result = await method(...values, ctx);
    return contract === undefined
      ? result
      : to_contract_reply(result, contract);
  };
}

/**
 * The topic of a handler of a contract, relative to its controller. The
 * contract has the whole topic: the topics of the module and of the
 * controller must be the start of it.
 *
 * @param full The topic of the contract.
 * @param parent The topics of the feature and of the controller, joined.
 * @param where Where the handler is declared, for the error message.
 * @returns What is left of the topic after its parents; `""` when nothing is.
 * @throws {ChoError} When the topic does not start with its parents.
 */
function contract_topic(full: string, parent: string, where: string): string {
  if (parent === "") {
    return full;
  }
  if (full === parent) {
    return "";
  }
  if (full.startsWith(`${parent}.`)) {
    return full.slice(parent.length + 1);
  }
  throw message_error(
    "CHO_MESSAGE_INVALID_TOPIC",
    `Invalid topic of ${where}: the topic of its contract, ${
      JSON.stringify(full)
    }, does not start with ${
      JSON.stringify(parent)
    }, the topic of its module and controller. A contract has the whole topic of its handler`,
  );
}

/**
 * The topic of a feature module or a controller: `""` when it declares none.
 *
 * @param meta The module's or controller's metadata.
 * @param where Where the topic is declared, for the error message.
 * @returns The trimmed, valid topic.
 */
function get_topic(
  meta: ModuleMetadata | ControllerMetadata,
  where: string,
): string {
  const topic = meta.options["topic"];
  return topic === undefined ? "" : normalize_topic(topic, where);
}

/**
 * The message handlers of a controller: its methods that `@Subscribe` marked,
 * with the topic it declared.
 *
 * @param meta The controller's metadata.
 * @returns Each handler method, with its topic.
 */
function subscribed_methods(
  meta: ControllerMetadata,
): [MethodMetadata, Subscription][] {
  const methods: [MethodMetadata, Subscription][] = [];
  for (const m of meta.methods) {
    const declared = subscription(m.meta);
    if (declared) {
      methods.push([m, declared]);
    }
  }
  return methods;
}

/**
 * Make the function that creates the error handler of a node: a function is
 * kept as is, a class with a `handle` method is created by the injector.
 *
 * @param mdl The module in whose scope a class is resolved.
 * @param injector The injector of the application.
 */
function error_handler_factory(
  mdl: Ctr,
  injector: Injector,
): (handler: unknown) => Promise<ErrorHandlerRef> {
  return async function (handler: unknown): Promise<ErrorHandlerRef> {
    if (handler === undefined) {
      return null;
    }
    assert_handle(handler, "Error handler");
    try {
      return await resolve_handle<ChoMessageErrorHandlerFn>(
        injector,
        handler,
        mdl,
      );
    } catch (error) {
      throw message_error(
        "CHO_MESSAGE_CREATE_FAILED",
        `Failed to create error handler ${describe(handler)} in module ${
          describe(mdl)
        }`,
        { cause: error },
      );
    }
  };
}

/**
 * Make the function that creates the middlewares of a node: a function is
 * kept as is, a class with a `handle` method is created by the injector.
 *
 * @param mdl The feature module: classes are resolved in its scope.
 * @param injector The injector of the application.
 */
function create_middleware_factory(
  mdl: Ctr,
  injector: Injector,
): (mws: readonly unknown[]) => Promise<ChoMessageMiddlewareFn[]> {
  return async function (mws: readonly unknown[]) {
    const fns: ChoMessageMiddlewareFn[] = [];
    for (const mw of mws) {
      assert_handle(mw, "Middleware");
      try {
        fns.push(
          await resolve_handle<ChoMessageMiddlewareFn>(injector, mw, mdl),
        );
      } catch (error) {
        throw message_error(
          "CHO_MESSAGE_CREATE_FAILED",
          `Failed to create middleware ${describe(mw)} in module ${
            describe(mdl)
          }`,
          { cause: error },
        );
      }
    }
    return fns;
  };
}

/**
 * Build the message graph of an application: every feature module, controller
 * and message handler, with their topics, middlewares and error handlers,
 * ready to invoke without the DI system.
 *
 * Only what handles a topic is part of the graph: a controller without a
 * message handler is left out, and so is a module left without such a
 * controller. Their middlewares and error handlers are not created. This is
 * what lets one module graph hold the controllers of another CHO module, such
 * as `@chojs/web`.
 *
 * Every topic of a controller is checked before the controller is resolved.
 * Controller instances, middleware classes and error handler classes are
 * created by the injector, in the scope of the module that declares the
 * controller.
 *
 * @param injector The injector of the application.
 * @param prefix The global topic prefix (`""` for none).
 * @param on_error The error handler of the application, if any: a function,
 *   or a class with a `handle` method, created by the injector in the scope
 *   of the root module.
 * @returns The message graph.
 * @throws {ChoError} When a topic is invalid, or when a middleware or an error
 *   handler is invalid or cannot be created.
 */
export async function build_message_graph(
  injector: Injector,
  prefix: unknown,
  on_error?: unknown,
): Promise<AppRef> {
  const topic = normalize_topic(prefix, "the global prefix");
  // A handler class is created in the scope of the root module.
  const root = injector.graph.root.ctr;
  const graph = new AppRef(
    topic,
    await error_handler_factory(root, injector)(on_error),
  );

  for (const mdl of injector.modules()) {
    const meta: ModuleMetadata = mdl.meta;

    // The topic of the module, read when it has a handler: a module that
    // is not a feature has its options ignored.
    let module_topic: string | undefined;
    const feature_topic = () =>
      module_topic ??= get_topic(meta, `feature ${describe(mdl.ctr)}`);

    // Topics first: nothing is created for an invalid topic.
    const controllers = meta.controllers.flatMap((ctrl) => {
      const methods = subscribed_methods(ctrl);
      if (methods.length === 0) {
        return [];
      }
      const name = describe(ctrl.provider.provide);
      const controller_topic = get_topic(ctrl, `controller ${name}`);
      return [{
        ctrl,
        topic: controller_topic,
        methods: methods.map(([m, declared]) => {
          const where = `method ${m.name} of controller ${name}`;
          const topic = normalize_topic(declared.topic, where);
          return {
            m,
            contract: declared.contract,
            topic: declared.contract
              ? contract_topic(
                topic,
                join_topic([feature_topic(), controller_topic]),
                where,
              )
              : topic,
          };
        }),
      }];
    });
    if (controllers.length === 0) {
      continue;
    }

    const error_handler = error_handler_factory(mdl.ctr, injector);
    const create_middlewares = create_middleware_factory(mdl.ctr, injector);

    const feature = new FeatureRef(
      feature_topic(),
      await create_middlewares(meta.middlewares),
      await error_handler(meta.errorHandler),
    );

    for (const { ctrl, topic: controller_topic, methods } of controllers) {
      const instance = await injector.resolve(ctrl.provider.provide, mdl.ctr);
      const controller = new ControllerRef(
        controller_topic,
        await create_middlewares(ctrl.middlewares),
        await error_handler(ctrl.errorHandler),
        instance,
      );

      for (const { m, topic: method_topic, contract } of methods) {
        const args = handler_args(m.meta)?.list ?? [];
        const middlewares = await create_middlewares(m.middlewares);
        // The nearest validation middleware decides: the handler's, then
        // the controller's, then the feature's.
        const validation = [
          ...feature.middlewares,
          ...controller.middlewares,
          ...middlewares,
        ].map(validation_of).findLast((options) => options !== undefined);
        controller.methods.push(
          new MethodRef(
            m.name,
            method_topic,
            middlewares,
            await error_handler(m.errorHandler),
            create_handler(
              instance[m.name].bind(instance),
              args,
              validation,
              contract &&
                `${describe(ctrl.provider.provide)}.${m.name}`,
            ),
            args,
            validation !== undefined,
            contract,
          ),
        );
      }
      feature.controllers.push(controller);
    }
    graph.features.push(feature);
  }
  return graph;
}
