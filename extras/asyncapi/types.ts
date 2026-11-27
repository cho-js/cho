/**
 * The types of an AsyncAPI 3.0 document, as far as `@chojs/asyncapi` writes
 * one. They are plain objects, and none is read-only: an application can
 * change a document before it serves it.
 *
 * @module
 */

import type { JsonSchema } from "@chojs/core/utils";

// A JSON Schema, as a plain object: the type of the core, which turns the
// validators of an application into schemas.
export type { JsonSchema };

/** A Reference Object: a pointer to another part of the document. */
export type AsyncApiReference = {
  /** The pointer: `"#/channels/orders.created"`. */
  $ref: string;
};

/** The External Documentation Object: more to read, somewhere else. */
export type AsyncApiExternalDocs = {
  /** Where it is. */
  url: string;
  /** What it is. */
  description?: string;
};

/** A Tag Object: a name operations are grouped by. */
export type AsyncApiTag = {
  /** The name of the tag. */
  name: string;
  /** What the tag is. */
  description?: string;
  /** More documentation of the tag. */
  externalDocs?: AsyncApiExternalDocs;
};

/** The Info Object: what the application is. */
export type AsyncApiInfo = {
  /** The title of the application. */
  title: string;
  /** The version of the application, not of AsyncAPI: `"1.0.0"`. */
  version: string;
  /** What the application does. */
  description?: string;
  /** The URL of the terms of service. */
  termsOfService?: string;
  /** Who to ask. */
  contact?: { name?: string; url?: string; email?: string };
  /** The license of the application. */
  license?: { name: string; url?: string };
  /** The tags of the application, with their descriptions. */
  tags?: AsyncApiTag[];
  /** More documentation of the application. */
  externalDocs?: AsyncApiExternalDocs;
};

/**
 * A Server Object: a broker the application connects to. What the package
 * does not read (`variables`, `security`, `bindings`, …) is written as it is
 * given.
 */
export type AsyncApiServer = {
  /** The host of the broker, with its port: `"kafka.example.com:9092"`. */
  host: string;
  /** The protocol: `"kafka"`, `"nats"`, `"amqp"`, … */
  protocol: string;
  /** The version of the protocol. */
  protocolVersion?: string;
  /** The path of a resource of the host. */
  pathname?: string;
  /** A name for people. */
  title?: string;
  /** One line about the server. */
  summary?: string;
  /** What the server is: `"The production broker"`. */
  description?: string;
  /** Any other field of the Server Object. */
  [field: string]: unknown;
};

/** A Message Object: what a message of a channel holds. */
export type AsyncApiMessage = {
  /** A name for programs: the topic of the message. */
  name?: string;
  /** A name for people. */
  title?: string;
  /** One line about the message. */
  summary?: string;
  /** What the message is. */
  description?: string;
  /** The media type of its value: `"application/json"`. */
  contentType?: string;
  /** The schema of its headers: an object, with a property for each header. */
  headers?: JsonSchema;
  /** The schema of its value. */
  payload?: JsonSchema;
  /**
   * The schema of its key. An extension of the package: AsyncAPI has the key
   * of a message in the bindings of a broker only.
   */
  "x-key"?: JsonSchema;
};

/** A Channel Object: a topic, and the messages that go through it. */
export type AsyncApiChannel = {
  /**
   * The topic. `null` when it is not known before a message is sent: the
   * reply to a request goes where who asked says.
   */
  address: string | null;
  /** A name for people. */
  title?: string;
  /** One line about the channel. */
  summary?: string;
  /** What the channel is. */
  description?: string;
  /** The messages of the channel, by a name of their own. */
  messages: Record<string, AsyncApiMessage>;
};

/** An Operation Reply Object: what answers the message of an operation. */
export type AsyncApiOperationReply = {
  /** The channel of the reply. */
  channel: AsyncApiReference;
  /** The messages of that channel that are the reply. */
  messages: AsyncApiReference[];
};

/** An Operation Object: the application receives a message, or sends one. */
export type AsyncApiOperation = {
  /** `"receive"`: a handler of the application. `"send"`: what it sends. */
  action: "send" | "receive";
  /** The channel of the operation. */
  channel: AsyncApiReference;
  /** The messages of that channel the operation is about. */
  messages: AsyncApiReference[];
  /** A name for people. */
  title?: string;
  /** One line about the operation. */
  summary?: string;
  /** What the operation does. */
  description?: string;
  /** The tags of the operation. */
  tags?: AsyncApiTag[];
  /** What answers the message, when something does. */
  reply?: AsyncApiOperationReply;
};

/** An AsyncAPI 3.0 document. */
export type AsyncApiDocument = {
  /** The version of AsyncAPI the document is written in. */
  asyncapi: "3.0.0";
  /** An identifier of the application: a URI. */
  id?: string;
  /** What the application is. */
  info: AsyncApiInfo;
  /** The brokers of the application, by a name of their own. */
  servers?: Record<string, AsyncApiServer>;
  /** The channels, by their topic. */
  channels: Record<string, AsyncApiChannel>;
  /** The operations, by their id. */
  operations: Record<string, AsyncApiOperation>;
  /** What the document refers to. */
  components?: {
    /** The schemas the other schemas refer to. */
    schemas?: Record<string, JsonSchema>;
  };
};
