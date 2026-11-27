/**
 * Makes the AsyncAPI document of a `@chojs/message` application, from its
 * graph.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import {
  debuglog,
  describe,
  Schemas,
  type ToJsonSchema,
} from "@chojs/core/utils";
import type { ChoMessage, ChoValidator, Contract } from "@chojs/message";
import { is_contract, type MethodRef } from "@chojs/message/graph";
import { asyncapi_error } from "./errors.ts";
import type {
  AsyncApiChannel,
  AsyncApiDocument,
  AsyncApiExternalDocs,
  AsyncApiInfo,
  AsyncApiMessage,
  AsyncApiOperation,
  AsyncApiReference,
  AsyncApiServer,
  JsonSchema,
} from "./types.ts";

/** A contract, whatever its types are. */
// deno-lint-ignore no-explicit-any
type AnyContract = Contract<any, any, any, any>;

/** The options of {@link asyncApiDocument}. */
export type AsyncApiDocumentOptions = {
  /** What the application is: its `title` and its `version` are required. */
  info: AsyncApiInfo;
  /** An identifier of the application: a URI. Default: none. */
  id?: string;
  /**
   * The brokers of the application, by a name of their own: each has a
   * `host` and a `protocol`. Default: none.
   */
  servers?: Readonly<Record<string, AsyncApiServer>>;
  /** A description for a tag, by its name: `{ orders: "The orders" }`. */
  tags?: Readonly<Record<string, string>>;
  /** More documentation of the application. */
  externalDocs?: AsyncApiExternalDocs;
  /**
   * What the application sends: its contracts, by the id of the operation.
   * The graph of an application only knows what it handles. Default: none.
   */
  sends?: Readonly<Record<string, AnyContract>>;
  /**
   * Turns a validator into a JSON Schema, for a validator that does not give
   * its own (see {@link ToJsonSchema}). Default: none.
   */
  toJsonSchema?: ToJsonSchema;
};

/** The names of the options, for the error of an unknown one. */
export const DOCUMENT_OPTIONS = [
  "externalDocs",
  "id",
  "info",
  "sends",
  "servers",
  "tags",
  "toJsonSchema",
] as const satisfies readonly (keyof AsyncApiDocumentOptions)[];

const JSON_TYPE = "application/json";

/** Whether a value is a plain object. */
function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a string with something in it. */
function is_text(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Check the options of a document, as far as it can be done without the
 * application.
 *
 * @param caller The function that was given the options, for the messages:
 *   `"asyncApiDocument()"`.
 * @param options The options.
 * @param known The names of the options the caller takes.
 * @throws {ChoError} When `info` has no title or no version, when a server
 *   has no host or no protocol, when an entry of `sends` is not a contract,
 *   or when an option is unknown.
 */
export function assert_document_options(
  caller: string,
  options: AsyncApiDocumentOptions,
  known: readonly string[] = DOCUMENT_OPTIONS,
): void {
  if (!is_object(options)) {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `${caller}: expected options, such as { info: { title: "My application", version: "1.0.0" } }`,
    );
  }
  assert_known_options(caller, options, known);
  const { info, servers, sends } = options;
  if (!is_object(info) || !is_text(info.title) || !is_text(info.version)) {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `${caller}: the "info" option is required: { title: "My application", version: "1.0.0" }`,
    );
  }
  if (servers !== undefined) {
    if (!is_object(servers)) {
      throw asyncapi_error(
        "CHO_ASYNCAPI_INVALID_OPTION",
        `${caller}: the "servers" option is an object of servers, by name, such as { production: { host: "kafka:9092", protocol: "kafka" } }, got ${
          describe(servers)
        }`,
      );
    }
    for (const [name, server] of Object.entries(servers)) {
      if (
        !is_object(server) || !is_text(server.host) ||
        !is_text(server.protocol)
      ) {
        throw asyncapi_error(
          "CHO_ASYNCAPI_INVALID_OPTION",
          `${caller}: the server ${
            JSON.stringify(name)
          } needs a host and a protocol: { host: "kafka:9092", protocol: "kafka" }`,
        );
      }
    }
  }
  if (sends !== undefined) {
    if (!is_object(sends)) {
      throw asyncapi_error(
        "CHO_ASYNCAPI_INVALID_OPTION",
        `${caller}: the "sends" option is an object of contracts, by the id of the operation, such as { orderShipped: OrderShipped }, got ${
          describe(sends)
        }`,
      );
    }
    for (const [name, sent] of Object.entries(sends)) {
      if (!is_contract(sent)) {
        throw asyncapi_error(
          "CHO_ASYNCAPI_INVALID_OPTION",
          `${caller}: ${
            JSON.stringify(name)
          } of the "sends" option must be a contract, made by contract(), got ${
            describe(sent)
          }`,
        );
      }
    }
  }
}

/**
 * Check that a value is a message application: what has the graph the
 * document is made from.
 *
 * @param caller The function that was given it, for the message.
 * @param app The value.
 * @throws {ChoError} When it has no graph.
 */
export function assert_application(
  caller: string,
  app: unknown,
): asserts app is ChoMessage<unknown> {
  const graph = is_object(app) ? app.graph : undefined;
  // The graph of a web application has features too, and a route where
  // this one has a topic.
  if (
    !is_object(graph) || !Array.isArray(graph.features) ||
    typeof graph.topic !== "string"
  ) {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `${caller}: expected a message application, made by ChoMessage.create or ChoMessage.from, got ${
        describe(app)
      }`,
    );
  }
}

/** A token of a JSON pointer: `~` and `/` are written `~0` and `~1`. */
function pointer_token(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** A reference to a channel of the document. */
function channel_ref(channel: string): AsyncApiReference {
  return { $ref: `#/channels/${pointer_token(channel)}` };
}

/** A reference to a message of a channel of the document. */
function message_ref(channel: string, message: string): AsyncApiReference {
  return {
    $ref: `#/channels/${pointer_token(channel)}/messages/${
      pointer_token(message)
    }`,
  };
}

/** A topic, with the prefix of the application before it. */
function with_prefix(prefix: string, topic: string): string {
  return [prefix, topic].filter((level) => level !== "").join(".");
}

/**
 * The message of a handler, from its arguments.
 *
 * - `Value(v)` is the payload, and `Value("name", v)` a property of it.
 * - `Header("x", v)` is a property of the headers, and `Header(v)` the
 *   headers, when its schema is an object.
 * - `Key()` and `Key(v)` are the key, written as the `x-key` extension.
 *
 * @param method The handler.
 * @param name Where it is declared: `OrdersController.created`.
 * @param topic Its whole topic: the name of the message.
 */
function read_message(
  method: MethodRef,
  name: string,
  topic: string,
  schemas: Schemas,
): AsyncApiMessage {
  const string = (): JsonSchema => ({ type: "string" });
  const of = (validator: ChoValidator | undefined, where: string) =>
    validator ? schemas.of(validator, "input", `${name}, ${where}`) : undefined;

  let reads_value = false;
  let payload: JsonSchema | undefined;
  const payload_properties: Record<string, JsonSchema> = {};
  let headers: JsonSchema | undefined;
  const header_properties: Record<string, JsonSchema> = {};
  let key: JsonSchema | undefined;

  for (const { info } of method.args) {
    // An argument of the application's own says nothing of what it reads.
    if (!info) {
      continue;
    }
    if (info.source === "value") {
      reads_value = true;
      if (info.key === undefined) {
        payload ??= of(info.validator, "the value");
      } else {
        payload_properties[info.key] ??= of(
          info.validator,
          `the property ${info.key} of the value`,
        ) ?? {};
      }
    } else if (info.source === "header") {
      if (info.key === undefined) {
        // The headers are an object: a schema of anything else says nothing.
        const schema = of(info.validator, "the headers");
        if (schema && schemas.resolve(schema).type === "object") {
          headers ??= schema;
        }
      } else {
        header_properties[info.key] ??=
          of(info.validator, `the header ${info.key}`) ?? string();
      }
    } else {
      key ??= of(info.validator, "the key") ?? string();
    }
  }

  // One value read by its properties: an object with them. None is marked
  // required: the schema of one property does not say whether it may be
  // missing.
  if (!payload && Object.keys(payload_properties).length > 0) {
    payload = { type: "object", properties: payload_properties };
  }
  if (Object.keys(header_properties).length > 0) {
    if (!headers) {
      headers = { type: "object", properties: header_properties };
    } else if (!("$ref" in headers)) {
      // The headers read one by one are added to those of the whole schema,
      // which says more of them.
      headers.properties = {
        ...header_properties,
        ...(is_object(headers.properties) ? headers.properties : {}),
      };
    }
  }

  return {
    name: topic,
    // `Value` reads JSON. A handler with no such argument reads the context
    // itself, and nothing says how.
    ...(reads_value ? { contentType: JSON_TYPE } : {}),
    ...(headers ? { headers } : {}),
    ...(payload ? { payload } : {}),
    ...(key ? { "x-key": key } : {}),
  };
}

/**
 * Make the AsyncAPI document of an application, from what it declares: the
 * topics of its handlers, their arguments with their schemas, their
 * contracts, and what `@Doc` says.
 *
 * The document is AsyncAPI 3.0.0, as a plain object: an application can
 * change it before it serves it. Nothing is called: no handler, and no
 * middleware.
 *
 * - **A handler** is a channel, whose address is its whole topic, and a
 *   `receive` operation. A handler that is hidden (`hidden: true` in its
 *   `@Doc`, or in the one of its controller or of its feature) is left out.
 * - **Its message** comes from its arguments: `Value` is the payload, and
 *   `Header` the headers. `Key` is written as the `x-key` extension.
 * - **Its reply** comes from its contract, or from the `reply` of its `@Doc`.
 *   It is a channel of its own, `<topic>/reply`, with no address: who asked
 *   says where the reply goes.
 * - **What the application sends** is in the `sends` option: each contract
 *   is a `send` operation.
 *
 * A validator gives its schema when it implements Standard JSON Schema (a
 * Zod schema does). Any other one is given to the `toJsonSchema` option; a
 * validator with no schema is documented without one. The schemas are JSON
 * Schema draft-07, the dialect of AsyncAPI 3.
 *
 * @param app The message application.
 * @param options The options: `info`, and what the application declares
 *   nowhere else.
 * @returns The document.
 * @throws {ChoError} When `app` is not a message application, when `info`
 *   has no title or no version, when an option is unknown or not valid, or
 *   when two operations have one id.
 *
 * @example
 * ```ts
 * const app = await ChoMessage.from(web.injector, { linker });
 * const document = asyncApiDocument(app, {
 *   info: { title: "Shop", version: "1.0.0" },
 *   servers: { production: { host: "kafka:9092", protocol: "kafka" } },
 *   sends: { orderShipped: OrderShipped },
 * });
 * ```
 */
export function asyncApiDocument(
  app: ChoMessage<unknown>,
  options: AsyncApiDocumentOptions,
): AsyncApiDocument {
  assert_application("asyncApiDocument()", app);
  assert_document_options("asyncApiDocument()", options);
  const log = debuglog("cho:asyncapi");
  const schemas = new Schemas("draft-07", options.toJsonSchema, log);

  const channels: Record<string, AsyncApiChannel> = {};
  const operations: Record<string, AsyncApiOperation> = {};
  /** Who has each id, for the error of a second one. */
  const ids = new Map<string, string>();
  const take_id = (id: string, who: string) => {
    const taken = ids.get(id);
    if (taken !== undefined) {
      throw asyncapi_error(
        "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
        `asyncApiDocument(): the operation id ${
          JSON.stringify(id)
        } is used by ${taken} and ${who}`,
      );
    }
    ids.set(id, who);
  };

  /**
   * The reply to the messages of a topic: its channel, made when it is not
   * there yet, and what an operation says of it.
   */
  const reply_of = (
    topic: string,
    validator: ChoValidator | undefined,
    description: string | undefined,
    json: boolean,
    who: string,
  ): Pick<AsyncApiOperation, "reply"> => {
    const id = `${topic}/reply`;
    if (!channels[id]) {
      const payload = validator
        ? schemas.of(validator, "input", `${who}, the reply`)
        : undefined;
      channels[id] = {
        // Not known before the request: who asks says where to answer.
        address: null,
        messages: {
          reply: {
            name: `${topic}.reply`,
            ...(description !== undefined ? { description } : {}),
            ...(json ? { contentType: JSON_TYPE } : {}),
            ...(payload ? { payload } : {}),
          },
        },
      };
    }
    return {
      reply: {
        channel: channel_ref(id),
        messages: [message_ref(id, "reply")],
      },
    };
  };

  const { graph } = app;
  for (const feature of graph.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const docs = [feature.doc, controller.doc, method.doc];
        if (docs.some((doc) => doc.hidden)) {
          continue;
        }
        const controller_name = describe(controller.instance.constructor);
        const name = `${controller_name}.${method.name}`;
        const topic = [
          graph.topic,
          feature.topic,
          controller.topic,
          method.topic,
        ].filter((level) => level !== "").join(".");
        const id = method.doc.operationId ?? name;
        take_id(id, name);

        const declared = [...new Set(docs.flatMap((doc) => doc.tags ?? []))];
        const tags = declared.length > 0
          ? declared
          : [controller_name.replace(/(?<=.)Controller$/, "")];

        channels[topic] = {
          address: topic,
          messages: { message: read_message(method, name, topic, schemas) },
        };
        const { contract, doc } = method;
        const replies = contract?.reply !== undefined ||
          doc.reply !== undefined;
        operations[id] = {
          action: "receive",
          channel: channel_ref(topic),
          messages: [message_ref(topic, "message")],
          ...(doc.summary !== undefined ? { summary: doc.summary } : {}),
          ...(doc.description !== undefined
            ? { description: doc.description }
            : {}),
          tags: tags.map((tag) => ({ name: tag })),
          ...(replies
            ? reply_of(
              topic,
              contract?.reply ?? doc.reply?.schema,
              doc.reply?.description,
              // A contract speaks JSON both ways. Any other handler replies
              // with bytes, with a text or with JSON: nothing says which.
              contract !== undefined,
              name,
            )
            : {}),
        };
      }
    }
  }

  for (const [id, sent] of Object.entries(options.sends ?? {})) {
    const who = `${JSON.stringify(id)} of the "sends" option`;
    take_id(id, who);
    // Who sends gives the prefix of who listens: the one of the application.
    const topic = with_prefix(graph.topic, sent.topic);
    // A topic the application handles too has its channel, and its message.
    if (!channels[topic]) {
      const payload = sent.request
        ? schemas.of(sent.request, "input", `${who}, the value`)
        : undefined;
      channels[topic] = {
        address: topic,
        messages: {
          message: {
            name: topic,
            contentType: JSON_TYPE,
            ...(payload ? { payload } : {}),
          },
        },
      };
    }
    operations[id] = {
      action: "send",
      channel: channel_ref(topic),
      messages: [message_ref(topic, "message")],
      ...(sent.reply ? reply_of(topic, sent.reply, undefined, true, who) : {}),
    };
  }

  const has_schemas = Object.keys(schemas.components).length > 0;
  const info: AsyncApiInfo = structuredClone(options.info);
  if (options.tags) {
    info.tags = Object.entries(options.tags).map(([name, description]) => ({
      name,
      description,
    }));
  }
  if (options.externalDocs) {
    info.externalDocs = { ...options.externalDocs };
  }
  return {
    asyncapi: "3.0.0",
    ...(options.id !== undefined ? { id: options.id } : {}),
    info,
    ...(options.servers
      ? { servers: structuredClone({ ...options.servers }) }
      : {}),
    channels,
    operations,
    ...(has_schemas ? { components: { schemas: schemas.components } } : {}),
  };
}
