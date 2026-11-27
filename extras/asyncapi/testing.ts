/**
 * What the tests of `@chojs/asyncapi` share: the decorators of
 * `@chojs/message`, applied by hand, the two applications, and validators
 * with a schema. Not published.
 *
 * @module
 */

import { ChoWeb } from "@chojs/web";
import {
  Args,
  ChoMessage,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";
import {
  type AnyMethodDecorator,
  legacy,
  loose,
} from "@chojs/core/utils/test_utils";
import { TestLinker } from "../../web/testing.ts";

// The validators a document is tested with: one with no schema, and two that
// say their own JSON Schema.
export {
  json_schema_only as schema_only,
  json_schema_validator as standard,
  parse_validator as plain,
} from "@chojs/core/utils/test_utils";

/** A class with no constructor argument. */
export type Class = new () => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
export const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** `@Subscribe`, of a topic or of a contract, applied by hand. */
export const subscribe = (given: unknown): AnyMethodDecorator =>
  loose(Subscribe(loose(given)));

/**
 * A controller with one handler for each topic: the handler of `created` is
 * the method `created`.
 *
 * @param name The name of the class.
 * @param topic The topic of the controller.
 * @param handlers The topic, or the contract, of each handler, by the name
 *   of its method, and what else decorates it.
 */
export function controller(
  name: string,
  topic: string,
  handlers: Record<string, [unknown, ...AnyMethodDecorator[]]>,
): Class {
  const made = { [name]: class {} }[name] as Class;
  for (const [method, [given, ...decorators]] of Object.entries(handlers)) {
    Object.defineProperty(made.prototype, method, {
      value: () => {},
      writable: true,
      configurable: true,
    });
    legacy(subscribe(given), made, method);
    for (const decorator of decorators) {
      legacy(decorator, made, method);
    }
  }
  Controller(topic === "" ? {} : { topic })(made);
  return made;
}

/** A module that declares controllers. */
export function feature(controllers: Class[], topic = ""): Class {
  class Feature {}
  Module({ controllers, ...(topic === "" ? {} : { topic }) })(Feature);
  return Feature;
}

/** Create the message application of a root module. */
export function create(
  root: Class,
  prefix = "",
): Promise<ChoMessage<unknown>> {
  return ChoMessage.create(root, { prefix });
}

/**
 * Create a web application and its consumers, on one injector, as an
 * application that has both does.
 */
export async function create_both(
  root: Class,
  prefix = "",
): Promise<{ web: ChoWeb<unknown>; app: ChoMessage<unknown> }> {
  const web = await ChoWeb.create(root, { linker: new TestLinker(), prefix });
  const app = await ChoMessage.from(web.injector);
  return { web, app };
}

/** Send a request to a web application. */
export function send(
  web: ChoWeb<unknown>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return web.handler(new Request(`http://localhost${path}`, init));
}

/**
 * The text of a piece of HTML, as a reader sees it: its tags removed, its
 * entities read, its spaces joined.
 */
export function text(markup: string): string {
  return markup
    .replace(/<style>[^]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}
