/**
 * The endpoints of an application: {@link endpoints} lists them,
 * {@link formatEndpoints} writes them as a table, and {@link printEndpoints}
 * prints it.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { dev_error } from "./errors.ts";
import { read } from "./inspect.ts";
import type {
  ChoDevEndpoint,
  ChoDevEndpointType,
  ChoDevGraph,
  ChoDevTarget,
} from "./types.ts";

/** The options of {@link formatEndpoints} and {@link printEndpoints}. */
export type FormatEndpointsOptions = {
  /** The types of endpoints to show. Default: all of them. */
  types?: readonly ChoDevEndpointType[];
};

/** The types of endpoints, in the order the table shows them. */
const TYPES: readonly ChoDevEndpointType[] = [
  "http",
  "sse",
  "ws",
  "message",
  "command",
];

/** The parts of the table: its title, and the types it holds. */
const GROUPS: readonly (readonly [string, readonly ChoDevEndpointType[]])[] = [
  ["HTTP", ["http", "sse", "ws"]],
  ["MESSAGE", ["message"]],
  ["COMMAND", ["command"]],
];

/**
 * The endpoints of an application: every HTTP route, stream of events,
 * WebSocket, message topic and command its controllers declare, in the order
 * they are declared.
 *
 * They are read from the metadata: nothing is created. An application as the
 * target adds its global prefix to the paths and to the topics, and its
 * mounted routes after the others.
 *
 * @param target A root module class, an injector, an application or a model.
 * @returns The endpoints.
 * @throws {ChoError} When the target is none of those, or when the metadata
 *   of the module is invalid.
 *
 * @example
 * ```ts
 * for (const endpoint of endpoints(AppModule)) {
 *   console.log(endpoint.type, endpoint.name); // "http", "GET /users"
 * }
 * ```
 */
export function endpoints(target: ChoDevTarget): ChoDevEndpoint[] {
  return endpoints_of(read("endpoints()", target));
}

function endpoints_of(graph: ChoDevGraph): ChoDevEndpoint[] {
  return graph.nodes.filter((node) => node.kind === "endpoint");
}

/**
 * Check the options of the table.
 *
 * @param caller The function that was called, for the error message.
 * @param options The options.
 * @throws {ChoError} When an option is unknown, or `types` names an unknown
 *   type.
 */
function assert_options(
  caller: string,
  options: unknown,
): asserts options is FormatEndpointsOptions {
  if (typeof options !== "object" || options === null) {
    throw dev_error(
      "CHO_DEV_INVALID_OPTION",
      `${caller}: expected options, such as { types: ["http"] }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options(caller, options, ["types"]);
  const { types } = options as { types?: unknown };
  if (types === undefined) {
    return;
  }
  if (!Array.isArray(types)) {
    throw dev_error(
      "CHO_DEV_INVALID_OPTION",
      `${caller}: "types" must be an array, got ${describe(types)}`,
    );
  }
  for (const type of types) {
    if (!(TYPES as readonly unknown[]).includes(type)) {
      throw dev_error(
        "CHO_DEV_INVALID_OPTION",
        `${caller}: unknown type ${describe(type)}. Known types: ${
          TYPES.join(", ")
        }`,
      );
    }
  }
}

/** The cells of a row: what is reached, then where it is declared. */
function row(
  endpoint: ChoDevEndpoint,
  names: ReadonlyMap<string, string>,
): string[] {
  const reached = endpoint.path !== undefined
    ? [
      endpoint.type === "http"
        ? endpoint.method ?? ""
        : endpoint.type.toUpperCase(),
      endpoint.path,
    ]
    : [endpoint.topic ?? endpoint.command ?? ""];
  const where = endpoint.controller === null
    ? [endpoint.handler, "(mounted)"]
    : [
      `${names.get(endpoint.controller) ?? "?"}.${endpoint.handler}`,
      names.get(endpoint.module) ?? "?",
    ];
  return [...reached, ...where, endpoint.middlewares.join(", ")];
}

/**
 * Write the endpoints of an application as a table of text.
 *
 * One part for each kind of application that has endpoints: `HTTP`, `MESSAGE`
 * and `COMMAND`. A line has what is reached (the method and the path, the
 * topic or the command), the method that handles it, its module, and the
 * middlewares that run for it, in order.
 *
 * ```text
 * HTTP
 * GET   /users       UsersController.list    UsersModule  auth
 * POST  /users       UsersController.create  UsersModule  auth, validation
 * WS    /chat/:room  ChatController.join     ChatModule
 *
 * MESSAGE
 * orders.created  OrdersController.created  OrdersModule
 * ```
 *
 * @param target A root module class, an injector, an application or a model.
 * @param options `types`: the types of endpoints to show.
 * @returns The table, with no line break at its end; `"No endpoints."` when
 *   there is nothing to show.
 * @throws {ChoError} When the target or an option is invalid.
 */
export function formatEndpoints(
  target: ChoDevTarget,
  options: FormatEndpointsOptions = {},
): string {
  return format("formatEndpoints()", target, options);
}

function format(caller: string, target: unknown, options: unknown): string {
  const graph = read(caller, target);
  assert_options(caller, options);
  const shown = options.types ?? TYPES;
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const all = endpoints_of(graph).filter((endpoint) =>
    shown.includes(endpoint.type)
  );
  const parts: string[] = [];
  for (const [title, types] of GROUPS) {
    const rows = all
      .filter((endpoint) => types.includes(endpoint.type))
      .map((endpoint) => row(endpoint, names));
    if (rows.length === 0) {
      continue;
    }
    const widths = rows[0]!.map((_, column) =>
      Math.max(...rows.map((cells) => cells[column]!.length))
    );
    const lines = rows.map((cells) =>
      cells
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join("  ")
        .trimEnd()
    );
    parts.push([title, ...lines].join("\n"));
  }
  return parts.length === 0 ? "No endpoints." : parts.join("\n\n");
}

/**
 * Print the endpoints of an application: the table of
 * {@link formatEndpoints}, written with `console.log`.
 *
 * @param target A root module class, an injector, an application or a model.
 * @param options `types`: the types of endpoints to show.
 * @throws {ChoError} When the target or an option is invalid.
 *
 * @example
 * ```ts
 * printEndpoints(AppModule);
 * ```
 */
export function printEndpoints(
  target: ChoDevTarget,
  options: FormatEndpointsOptions = {},
): void {
  console.log(format("printEndpoints()", target, options));
}
