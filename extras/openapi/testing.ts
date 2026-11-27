/**
 * What the tests of `@chojs/openapi` share: validators with a schema, and
 * the decorators of `@chojs/web`, applied by hand. Not published.
 *
 * @module
 */

import { Args, ChoWeb } from "@chojs/web";
import { type AnyMethodDecorator, loose } from "@chojs/core/utils/test_utils";
import { TestLinker } from "../../web/testing.ts";

/** A class with no constructor argument. */
export type Class = new () => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
export const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** Create the application of a root module, with the test linker. */
export function create(root: Class, prefix = ""): Promise<ChoWeb<unknown>> {
  return ChoWeb.create(root, { linker: new TestLinker(), prefix });
}

/** Send a request to an application. */
export function send(
  app: ChoWeb<unknown>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.handler(new Request(`http://localhost${path}`, init));
}

// The validators a document is tested with: one with no schema, and two that
// say their own JSON Schema.
export {
  json_schema_only as schema_only,
  json_schema_validator as standard,
  parse_validator as plain,
} from "@chojs/core/utils/test_utils";
