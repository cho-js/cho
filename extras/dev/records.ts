/**
 * What the decorators of `@chojs/web`, `@chojs/message` and `@chojs/command`
 * wrote on a method, read back.
 *
 * The three packages are not imported: their records are found by their keys,
 * which are global symbols (`Symbol.for`). So this package depends on the core
 * alone, and an application of one kind does not install the other two.
 *
 * The price is that the shape of each record is written here a second time.
 * The tests declare real controllers, with the real decorators, and compare
 * what is read here with the routes of the application: a record that changes
 * fails them.
 *
 * @module
 */

import type { ChoDevSocketEvent } from "./types.ts";

/** The key of `@Get`, `@Post`, ..., `@Sse` and `@Ws` (`web/keys.ts`). */
const HTTP = Symbol.for("chojs.web.http");
/** The key of `@WsOpen`, `@WsMessage` and `@WsClose` (`web/keys.ts`). */
const WS = Symbol.for("chojs.web.ws");
/** The key of `@Subscribe` (`message/keys.ts`). */
const SUBSCRIBE = Symbol.for("chojs.message.subscribe");
/** The keys of `@Main` and `@Action` (`command/keys.ts`). */
const MAIN = Symbol.for("chojs.command.isMain");
const ACTION = Symbol.for("chojs.command.isAction");
const ALIAS = Symbol.for("chojs.command.alias");

/** A record of a method, or the options of a class. */
type Rec = Readonly<Record<PropertyKey, unknown>>;

/** The events of a socket, in the order they happen. */
const SOCKET_EVENTS: readonly ChoDevSocketEvent[] = [
  "open",
  "message",
  "close",
];

const is_object = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null;

/** A level of a route or of a topic: trimmed; `""` when there is none. */
export function level(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** What an HTTP method decorator declares about a method. */
export type HttpRecord = {
  /** What the endpoint is. */
  type: "http" | "sse" | "ws";
  /** The HTTP method. */
  method: string;
  /** The route of the method, relative to its controller. */
  route: string;
};

/**
 * The route a method record declares, if any.
 *
 * @param record The record of a method.
 * @returns What the decorator wrote, or `undefined` for a method that is not
 *   an HTTP handler.
 */
export function http_record(record: Rec): HttpRecord | undefined {
  const http = record[HTTP];
  if (!is_object(http) || typeof http["method"] !== "string") {
    return undefined;
  }
  return {
    type: http["socket"] === true
      ? "ws"
      : http["sse"] !== undefined
      ? "sse"
      : "http",
    method: http["method"],
    route: level(http["route"]),
  };
}

/**
 * The event of a socket a method record declares, if any.
 *
 * @param record The record of a method.
 * @returns The event, or `undefined` for a method that handles none.
 */
export function socket_record(record: Rec): ChoDevSocketEvent | undefined {
  const event = record[WS];
  return SOCKET_EVENTS.find((known) => known === event);
}

/**
 * Put the events of a socket in the order they happen.
 *
 * @param events The events a controller handles.
 * @returns The same events, each once, in order.
 */
export function order_events(
  events: readonly ChoDevSocketEvent[],
): ChoDevSocketEvent[] {
  return SOCKET_EVENTS.filter((event) => events.includes(event));
}

/** What `@Subscribe` declares about a method. */
export type MessageRecord = {
  /** The topic, as declared. */
  topic: string;
  /**
   * Whether it is the topic of a contract: the whole topic of the handler,
   * and not one that is relative to its controller.
   */
  whole: boolean;
};

/**
 * The topic a method record declares, if any.
 *
 * @param record The record of a method.
 * @returns What `@Subscribe` wrote, or `undefined` for a method that is not a
 *   message handler.
 */
export function message_record(record: Rec): MessageRecord | undefined {
  const subscription = record[SUBSCRIBE];
  if (!is_object(subscription) || typeof subscription["topic"] !== "string") {
    return undefined;
  }
  return {
    topic: level(subscription["topic"]),
    whole: subscription["contract"] !== undefined,
  };
}

/**
 * The command a method record declares, if any.
 *
 * @param record The record of a method.
 * @returns The name of the command (`"main"` for `@Main`), or `undefined` for
 *   a method that is not a command.
 */
export function command_record(record: Rec): string | undefined {
  if (record[MAIN] !== true && record[ACTION] !== true) {
    return undefined;
  }
  const alias = record[ALIAS];
  return typeof alias === "string" ? alias : "main";
}

/**
 * Join the levels of a path, as `@chojs/web` does.
 *
 * @param levels The routes of the application, the module, the controller and
 *   the method.
 * @returns The whole path, starting with `/`.
 */
export function join_path(levels: readonly string[]): string {
  return "/" + levels.filter((part) => part !== "").join("/");
}

/**
 * Join the levels of a topic, as `@chojs/message` does.
 *
 * @param levels The topics of the application, the module, the controller and
 *   the method.
 * @returns The whole topic; `""` when every level is empty.
 */
export function join_topic(levels: readonly string[]): string {
  return levels.filter((part) => part !== "").join(".");
}
