/**
 * The model of an application, as `@chojs/dev` reads it: its modules, what
 * they declare, its endpoints, and how they relate.
 *
 * It is plain data: strings, booleans, arrays and `null`. So it can be written
 * as JSON and read back with nothing lost, put in a page, or compared with a
 * snapshot in a test. It holds names, routes and topics: no value of a
 * provider, no instance, no function.
 *
 * @module
 */

import type { DependencyGraph, MetadataGraph } from "@chojs/core/di";
import type { Ctr } from "@chojs/core";

/** What every node of the model has. */
type NodeBase = {
  /**
   * What identifies the node in its graph. It is readable, and the same from
   * one run to the next: `"AppModule"`, `"UsersModule/UsersService"`,
   * `"UsersModule/UsersController.list"`.
   */
  id: string;
  /** The name to show: of the class, of the token, or of the endpoint. */
  name: string;
  /** The id of the module that declares the node; of a module, its own. */
  module: string;
};

/** A module of the application. */
export type ChoDevModule = NodeBase & {
  /** The kind of the node. */
  kind: "module";
  /** Whether it is the root module. */
  root: boolean;
  /** The names of its middlewares (`@Middlewares`), in order. */
  middlewares: string[];
  /** The name of its error handler (`@Catch`), or `null`. */
  errorHandler: string | null;
};

/** A provider a module declares: an `@Injectable` class, or a provider object. */
export type ChoDevProvider = NodeBase & {
  /** The kind of the node. */
  kind: "provider";
  /** What its token is: a class, an injection token or a symbol. */
  token: "class" | "token" | "symbol";
};

/** A controller a module declares. */
export type ChoDevController = NodeBase & {
  /** The kind of the node. */
  kind: "controller";
  /** The names of its middlewares (`@Middlewares`), in order. */
  middlewares: string[];
  /** The name of its error handler (`@Catch`), or `null`. */
  errorHandler: string | null;
};

/** What an endpoint is. */
export type ChoDevEndpointType = "http" | "sse" | "ws" | "message" | "command";

/** An event of a socket that a controller handles. */
export type ChoDevSocketEvent = "open" | "message" | "close";

/**
 * An endpoint: a method of a controller that something outside the
 * application can reach. An HTTP route, a stream of events, a WebSocket, a
 * topic of messages or a command.
 */
export type ChoDevEndpoint = NodeBase & {
  /** The kind of the node. */
  kind: "endpoint";
  /** What the endpoint is. */
  type: ChoDevEndpointType;
  /**
   * The id of its controller; `null` for a route that was mounted on the
   * application (`app.mount`), which has none.
   */
  controller: string | null;
  /**
   * The name of the method on the controller; for a mounted route, the name
   * the route was given.
   */
  handler: string;
  /** The HTTP method, for `http`, `sse` and `ws`: `"GET"`. */
  method?: string;
  /** The whole path, for `http`, `sse` and `ws`: `"/users/:id"`. */
  path?: string;
  /** The whole topic, for `message`: `"orders.created"`. */
  topic?: string;
  /** The name of the command, for `command`; `"main"` for `@Main`. */
  command?: string;
  /** The events its controller handles, for `ws`. */
  events?: ChoDevSocketEvent[];
  /**
   * The names of the middlewares that run for it, in order: those of its
   * module, of its controller and its own.
   */
  middlewares: string[];
  /**
   * The name of the error handler that covers it: its own, or that of its
   * controller, or that of its module; `null` when none does.
   */
  errorHandler: string | null;
  /** Whether it is a route that was mounted on the application. */
  mounted: boolean;
};

/**
 * What a module asks for and nothing gives: a dependency that is not in its
 * scope, or that two imports export. Only a broken application has some.
 */
export type ChoDevMissing = NodeBase & {
  /** The kind of the node. */
  kind: "missing";
};

/** A node of the model. */
export type ChoDevNode =
  | ChoDevModule
  | ChoDevProvider
  | ChoDevController
  | ChoDevEndpoint
  | ChoDevMissing;

/** The kind of a node. */
export type ChoDevNodeKind = ChoDevNode["kind"];

/**
 * A relation between two nodes:
 *
 * - `imports`: a module imports a module;
 * - `exports`: a module exports a declaration, its own or one it imports;
 * - `injects`: a declaration receives another one as a dependency.
 *
 * What declares what is not an edge: it is the `module` of a node, and the
 * `controller` of an endpoint.
 */
export type ChoDevEdge = {
  /** What the relation is. */
  kind: "imports" | "exports" | "injects";
  /** The id of the node the relation starts from. */
  from: string;
  /** The id of the node it leads to. */
  to: string;
};

/** The model of an application. */
export type ChoDevGraph = {
  /** The id of the root module. */
  root: string;
  /**
   * The nodes: each module, the root first, followed by what it declares; a
   * controller is followed by its endpoints.
   */
  nodes: ChoDevNode[];
  /** The relations between the nodes. */
  edges: ChoDevEdge[];
  /**
   * What is wrong with the application, when its dependencies cannot be
   * linked: the code and the message of the error an injector would throw.
   * `null` for an application that is sound.
   */
  error: { code: string; message: string } | null;
};

/** An injector, as far as it is read: its two graphs. */
export type ChoDevInjector = {
  /** The metadata graph. */
  readonly meta: MetadataGraph;
  /** The dependency graph. */
  readonly graph: DependencyGraph;
};

/**
 * An application, as far as it is read: its injector, and what only an
 * application knows: its global prefix and its routes.
 */
export type ChoDevApplication = {
  /** The injector of the application. */
  readonly injector: ChoDevInjector;
  /** The graph of the application: its prefix is read from it. */
  readonly graph?: unknown;
  /** The routes of the application: the mounted ones are read from it. */
  readonly routes?: unknown;
};

/**
 * What the tools read:
 *
 * - a root module class: the usual one. Nothing is created;
 * - an injector, or an application that has one (`ChoWeb`, `ChoMessage`), for
 *   code that already holds one. An application adds its global prefix and
 *   the routes that were mounted on it;
 * - a model that {@link ChoDevGraph | `inspect`} already made.
 */
export type ChoDevTarget =
  | Ctr
  | ChoDevInjector
  | ChoDevApplication
  | ChoDevGraph;

/**
 * Which nodes of a model to keep. Every rule that is given must hold.
 *
 * A node that is kept keeps its module, and an endpoint its controller. An
 * edge is kept when both its ends are.
 */
export type ChoDevFilter = {
  /**
   * The kinds to keep: kinds of nodes, and types of endpoints (`"endpoint"`
   * keeps them all). Default: everything.
   */
  kinds?: readonly (ChoDevNodeKind | ChoDevEndpointType)[];
  /**
   * A text to find, with no regard to case, in the name of a node, in its
   * path, its topic or its command, and in the name of its module. Default:
   * no search.
   */
  search?: string;
  /** The id of a node: only it, and what is near it, is kept. */
  around?: string;
  /**
   * How near, for `around`: the number of steps, along the edges and between
   * a controller and its endpoints. Default: `1`.
   */
  depth?: number;
};
