/**
 * Builds the message graph (see `graph.ts`) of an application from its
 * injector, and validates each topic. Internal to `@chojs/message`:
 * `ChoMessage` calls {@link build_message_graph}; it is not a package export.
 *
 * @module
 */

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
  AppRef,
  ControllerRef,
  type ErrorHandlerRef,
  FeatureRef,
  MethodRef,
} from "./graph.ts";
import { type Subscription, subscription } from "./keys.ts";
import { normalize_topic } from "./topic.ts";
import type {
  ChoMessageErrorHandlerFn,
  ChoMessageMiddlewareFn,
} from "./types.ts";

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
      throw new Error(
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
        throw new Error(
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
 * @throws {Error} When a topic is invalid, or when a middleware or an error
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

    // Topics first: nothing is created for an invalid topic.
    const controllers = meta.controllers.flatMap((ctrl) => {
      const methods = subscribed_methods(ctrl);
      if (methods.length === 0) {
        return [];
      }
      const name = describe(ctrl.provider.provide);
      return [{
        ctrl,
        topic: get_topic(ctrl, `controller ${name}`),
        methods: methods.map(([m, declared]) => ({
          m,
          topic: normalize_topic(
            declared.topic,
            `method ${m.name} of controller ${name}`,
          ),
        })),
      }];
    });
    if (controllers.length === 0) {
      continue;
    }

    const error_handler = error_handler_factory(mdl.ctr, injector);
    const create_middlewares = create_middleware_factory(mdl.ctr, injector);

    const feature = new FeatureRef(
      get_topic(meta, `feature ${describe(mdl.ctr)}`),
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

      for (const { m, topic: method_topic } of methods) {
        controller.methods.push(
          new MethodRef(
            m.name,
            method_topic,
            await create_middlewares(m.middlewares),
            await error_handler(m.errorHandler),
            instance[m.name].bind(instance),
          ),
        );
      }
      feature.controllers.push(controller);
    }
    graph.features.push(feature);
  }
  return graph;
}
