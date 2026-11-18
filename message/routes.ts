/**
 * Compiles the message graph (see `graph.ts`) into the flat list of routes a
 * linker subscribes to (see `linker.ts`). Internal to `@chojs/message`.
 *
 * Each route is one function that does all the plumbing of a message: it
 * creates the context, runs the middlewares of the feature, the controller
 * and the handler, and hands errors to the nearest error handler.
 *
 * @module
 */

import { message_error } from "./errors.ts";
import { type Debuglog, debuglog, describe } from "@chojs/core/utils";
import { compose } from "./compose.ts";
import { create_context } from "./context.ts";
import type { AppRef } from "./graph.ts";
import type { Route } from "./linker.ts";
import { join_topic } from "./topic.ts";

/**
 * Throw if two routes handle the same topic.
 *
 * @param routes The routes of the application.
 * @throws {ChoError} On two routes with the same topic.
 */
export function assert_no_duplicate_topics(routes: readonly Route[]): void {
  const seen = new Map<string, Route>();
  for (const route of routes) {
    const previous = seen.get(route.topic);
    if (previous) {
      throw message_error(
        "CHO_MESSAGE_DUPLICATE_TOPIC",
        `Duplicate topic ${
          describe(route.topic)
        }: declared by ${previous.name} and ${route.name}` +
          // one handler, twice: its controller is declared by two modules
          (previous.name === route.name
            ? ". Its controller is declared in more than one module: declare it in one."
            : ""),
      );
    }
    seen.set(route.topic, route);
  }
}

/**
 * Compile the routes of a message graph.
 *
 * For each handler, in declaration order:
 *
 * - the topic joins the global prefix and the feature's, the controller's and
 *   the handler's topics, with `.`;
 * - the chain is the feature's, the controller's, then the handler's
 *   middlewares, then the handler, whose result is ignored;
 * - an error thrown anywhere in the chain goes to the nearest error handler
 *   (the handler's, the controller's, the feature's, then the application's).
 *   When it returns `true`, the message is handled. Otherwise, without one, or
 *   when it throws too, the route rejects with the original error: the
 *   message failed.
 *
 * @param graph The message graph of the application.
 * @param log The `cho:message` debug logger: each message that fails is
 *   logged to it.
 * @returns The routes.
 * @throws {ChoError} When the topic of a handler is empty, or when two routes
 *   handle the same topic.
 */
export function compile_routes(
  graph: AppRef,
  log: Debuglog = debuglog("cho:message"),
): Route[] {
  const routes: Route[] = [];
  for (const feature of graph.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const name = `${
          describe(controller.instance.constructor)
        }.${method.name}`;
        const topic = join_topic([
          graph.topic,
          feature.topic,
          controller.topic,
          method.topic,
        ]);
        if (topic === "") {
          throw message_error(
            "CHO_MESSAGE_INVALID_TOPIC",
            `Invalid topic of ${name}: it is empty. Give @Subscribe(), its controller or its module a topic`,
          );
        }
        const on_error = method.errorHandler ?? controller.errorHandler ??
          feature.errorHandler ?? graph.errorHandler;
        const run = compose(
          [
            ...feature.middlewares,
            ...controller.middlewares,
            ...method.middlewares,
          ],
          async (ctx) => {
            await method.handler(ctx);
          },
        );

        routes.push({
          topic,
          name,
          async handle(delivery, native) {
            const ctx = create_context(topic, delivery, native);
            try {
              await run(ctx);
            } catch (error) {
              log.error(`${topic} (${name}) failed:`, error);
              if (!on_error) {
                throw error;
              }
              let handled: unknown;
              try {
                handled = await on_error(error, ctx);
              } catch (cause) {
                // The message failed with its own error: this one would
                // otherwise be lost.
                console.error(
                  `The error handler of ${name} failed:`,
                  cause,
                );
                throw error;
              }
              // Only `true` settles the message. Anything else, nothing
              // included, leaves it failed: an error handler that only logs
              // must not lose the message.
              if (handled !== true) {
                throw error;
              }
            }
          },
        });
      }
    }
  }
  assert_no_duplicate_topics(routes);
  return routes;
}
