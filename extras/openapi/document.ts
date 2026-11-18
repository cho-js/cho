/**
 * Makes the OpenAPI document of a `@chojs/web` application, from its graph.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { openapi_error } from "./errors.ts";
import type { ChoWeb, ChoWebDocSecurity, ChoWebValidator } from "@chojs/web";
import type { ControllerRef, FeatureRef, MethodRef } from "@chojs/web/graph";
import { debuglog, describe } from "@chojs/core/utils";
import { Schemas, type ToJsonSchema } from "./schema.ts";
import type {
  JsonSchema,
  OpenApiDocument,
  OpenApiExternalDocs,
  OpenApiInfo,
  OpenApiMediaType,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecurityRequirement,
  OpenApiSecurityScheme,
  OpenApiServer,
} from "./types.ts";

/** The options of {@link openApiDocument}. */
export type OpenApiDocumentOptions = {
  /** What the API is: its `title` and its `version` are required. */
  info: OpenApiInfo;
  /**
   * Where the API is served. Default: none, and a client calls the origin of
   * the page that shows the document.
   */
  servers?: readonly OpenApiServer[];
  /** A description for a tag, by its name: `{ users: "The users" }`. */
  tags?: Readonly<Record<string, string>>;
  /** The ways to authenticate, by name: what `security` refers to. */
  securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>;
  /**
   * What every operation requires, unless the `security` of a `@Doc` says
   * otherwise. Default: nothing.
   */
  security?: readonly ChoWebDocSecurity[];
  /** More documentation of the API. */
  externalDocs?: OpenApiExternalDocs;
  /**
   * Turns a validator into a JSON Schema, for a validator that does not give
   * its own (see {@link ToJsonSchema}). Default: none.
   */
  toJsonSchema?: ToJsonSchema;
};

/** The names of the options, for the error of an unknown one. */
export const DOCUMENT_OPTIONS = [
  "externalDocs",
  "info",
  "security",
  "securitySchemes",
  "servers",
  "tags",
  "toJsonSchema",
] as const satisfies readonly (keyof OpenApiDocumentOptions)[];

/** The methods a Path Item Object has a field for. */
const METHODS: Readonly<Record<string, OpenApiMethod>> = {
  GET: "get",
  PUT: "put",
  POST: "post",
  DELETE: "delete",
  OPTIONS: "options",
  HEAD: "head",
  PATCH: "patch",
};

/** The reason phrases of the statuses an API usually answers with. */
const REASONS: Readonly<Record<string, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const JSON_TYPE = "application/json";
const FORM_TYPE = "application/x-www-form-urlencoded";

/** Whether a value is a plain object. */
function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check the options of a document, as far as it can be done without the
 * application.
 *
 * @param caller The function that was given the options, for the messages:
 *   `"openApiDocument()"`.
 * @param options The options.
 * @param known The names of the options the caller takes.
 * @throws {ChoError} When `info` has no title or no version, or when an option
 *   is unknown.
 */
export function assert_document_options(
  caller: string,
  options: OpenApiDocumentOptions,
  known: readonly string[] = DOCUMENT_OPTIONS,
): void {
  if (!is_object(options)) {
    throw openapi_error(
      "CHO_OPENAPI_INVALID_OPTION",
      `${caller}: expected options, such as { info: { title: "My API", version: "1.0.0" } }`,
    );
  }
  assert_known_options(caller, options, known);
  const { info } = options;
  if (
    !is_object(info) || typeof info.title !== "string" || info.title === "" ||
    typeof info.version !== "string" || info.version === ""
  ) {
    throw openapi_error(
      "CHO_OPENAPI_INVALID_OPTION",
      `${caller}: the "info" option is required: { title: "My API", version: "1.0.0" }`,
    );
  }
}

/** A copy of a list of security requirements, for the document. */
function to_security(
  security: readonly ChoWebDocSecurity[],
): OpenApiSecurityRequirement[] {
  return security.map((requirement) =>
    Object.fromEntries(
      Object.entries(requirement).map(([name, scopes]) => [name, [...scopes]]),
    )
  );
}

/** The full path of a handler, as `@chojs/web` joins its four levels. */
function full_path(levels: readonly string[]): string {
  return "/" + levels.filter((level) => level !== "").join("/");
}

/** What one operation is made from. */
type Source = {
  readonly feature: FeatureRef;
  readonly controller: ControllerRef;
  readonly method: MethodRef;
  /** Where the handler is declared: `UsersController.update`. */
  readonly name: string;
};

/**
 * The parameters and the request body of a handler, from its arguments.
 *
 * @param path_params The parameters of the path, in order.
 */
function read_arguments(
  { method, name }: Source,
  path_params: readonly string[],
  schemas: Schemas,
): Pick<OpenApiOperation, "parameters" | "requestBody"> {
  const string = (): JsonSchema => ({ type: "string" });
  // By source and name. `schema` is undefined until an argument gives one.
  const found = new Map<
    string,
    {
      name: string;
      in: OpenApiParameter["in"];
      schema?: JsonSchema;
      required: boolean;
    }
  >();
  const add = (
    source: OpenApiParameter["in"],
    key: string,
    schema: JsonSchema | undefined,
    required: boolean,
  ) => {
    const id = `${source} ${key}`;
    const existing = found.get(id);
    if (!existing) {
      found.set(id, {
        name: key,
        in: source,
        required: source === "path" || required,
        ...(schema ? { schema } : {}),
      });
    } else {
      // Once in the document: the first argument that has a schema.
      if (schema && !existing.schema) {
        existing.schema = schema;
      }
      existing.required ||= required;
    }
  };
  // The parameters of the path first, in its order: each one is required.
  for (const key of path_params) {
    add("path", key, undefined, true);
  }

  /** The body of one media type: whole, or the properties read by key. */
  type Body = { whole?: JsonSchema; properties: Record<string, JsonSchema> };
  const bodies = new Map<string, Body>();
  const body_of = (type: string): Body => {
    let body = bodies.get(type);
    if (!body) {
      bodies.set(type, body = { properties: {} });
    }
    return body;
  };

  for (const arg of method.args) {
    const info = arg.info;
    if (!info) {
      continue; // a function of the application's own: it says nothing
    }
    const where = `${name}, ${info.source} ${info.key ?? "(whole)"}`;
    const schema = info.validator
      ? schemas.of(info.validator, "input", where)
      : undefined;
    if (info.source === "body" || info.source === "form") {
      const body = body_of(info.source === "body" ? JSON_TYPE : FORM_TYPE);
      if (info.key === undefined) {
        body.whole ??= schema ?? {};
      } else {
        body.properties[info.key] ??= schema ?? {};
      }
      continue;
    }
    const source = info.source === "param" ? "path" : info.source;
    if (info.key !== undefined) {
      add(source, info.key, schema, false);
      continue;
    }
    // The whole source: one parameter for each property of its schema.
    const object = schema && schemas.resolve(schema);
    if (!object || !is_object(object.properties)) {
      continue;
    }
    const required = Array.isArray(object.required) ? object.required : [];
    for (const [key, property] of Object.entries(object.properties)) {
      add(
        source,
        key,
        is_object(property) ? property : undefined,
        required.includes(key),
      );
    }
  }

  const parameters: OpenApiParameter[] = [...found.values()].map((p) => ({
    name: p.name,
    in: p.in,
    ...(p.required ? { required: true } : {}),
    schema: p.schema ?? string(),
  }));
  const content: Record<string, OpenApiMediaType> = {};
  let required = false;
  for (const [type, body] of bodies) {
    required ||= body.whole !== undefined;
    content[type] = {
      schema: body.whole ?? { type: "object", properties: body.properties },
    };
  }
  const request_body: OpenApiRequestBody | undefined = bodies.size === 0
    ? undefined
    : { ...(required ? { required: true } : {}), content };
  return {
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(request_body ? { requestBody: request_body } : {}),
  };
}

/** The responses of a handler: those of its `@Doc`, and what is added. */
function read_responses(
  { method, name }: Source,
  schemas: Schemas,
): Record<string, OpenApiResponse> {
  const responses: Record<string, OpenApiResponse> = {};
  for (const [status, declared] of Object.entries(method.doc.responses ?? {})) {
    const { description, schema, contentType } = declared ?? {};
    const of_body = schema &&
      schemas.of(
        schema as ChoWebValidator,
        "output",
        `${name}, response ${status}`,
      );
    responses[status] = {
      description: description ?? REASONS[status] ?? "Response",
      ...(schema || contentType
        ? {
          content: {
            [contentType ?? JSON_TYPE]: of_body ? { schema: of_body } : {},
          },
        }
        : {}),
    };
  }
  const statuses = Object.keys(responses);
  if (!statuses.some((status) => status.startsWith("2"))) {
    responses["200"] = method.sse === undefined ? { description: "OK" } : {
      description: "OK",
      content: { "text/event-stream": { schema: { type: "string" } } },
    };
  }
  if (
    method.validated && !("400" in responses) &&
    method.args.some((arg) => arg.info?.validator)
  ) {
    responses["400"] = { description: "The request is not valid" };
  }
  return responses;
}

/**
 * Make the OpenAPI document of an application, from what the application
 * declares: its routes, the arguments of its handlers, and its `@Doc`.
 *
 * It reads the graph of the application (`app.graph`). It does no I/O, calls
 * no handler and no middleware, and returns a new plain object each time: the
 * application can change it before it serves it. The document is OpenAPI
 * 3.1.1.
 *
 * - Each handler is one operation, unless its `@Doc`, the one of its
 *   controller or the one of its feature says `hidden`.
 * - The parameters and the request body come from the arguments of the
 *   handler (`@Args`), with the schemas of their validators.
 * - The responses come from the `responses` of its `@Doc`.
 * - A route mounted on the application (`app.mount`) is not in the graph,
 *   and so not in the document.
 *
 * A validator gives its schema when it implements Standard JSON Schema (a
 * Zod schema does). Any other one is given to the `toJsonSchema` option; a
 * validator with no schema is documented without one.
 *
 * @param app The application.
 * @param options The options: `info`, and what the application declares
 *   nowhere else.
 * @returns The document.
 * @throws {ChoError} When `info` has no title or no version, when an option is
 *   unknown, when two operations have one `operationId`, or when a
 *   `security` names a scheme the `securitySchemes` option does not have.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule);
 * const document = openApiDocument(app, {
 *   info: { title: "Shop", version: "1.0.0" },
 *   securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
 *   security: [{ bearer: [] }],
 * });
 * ```
 */
export function openApiDocument(
  app: ChoWeb<unknown>,
  options: OpenApiDocumentOptions,
): OpenApiDocument {
  assert_document_options("openApiDocument()", options);
  const log = debuglog("cho:openapi");
  const schemas = new Schemas(options.toJsonSchema, log);
  const schemes = options.securitySchemes ?? {};
  /** Throw for a requirement that names a scheme the document has not. */
  const assert_schemes = (
    security: readonly ChoWebDocSecurity[],
    who: string,
  ) => {
    for (const requirement of security) {
      for (const scheme of Object.keys(requirement)) {
        if (!Object.hasOwn(schemes, scheme)) {
          throw openapi_error(
            "CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME",
            `openApiDocument(): ${who} requires the security scheme ${
              JSON.stringify(scheme)
            }, which is not in the "securitySchemes" option`,
          );
        }
      }
    }
  };
  if (options.security) {
    assert_schemes(options.security, 'the "security" option');
  }

  const paths: OpenApiDocument["paths"] = {};
  const ids = new Map<string, string>();
  const { graph } = app;
  for (const feature of graph.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const docs = [feature.doc, controller.doc, method.doc];
        const verb = METHODS[method.method];
        if (docs.some((doc) => doc.hidden) || !verb) {
          continue;
        }
        const name = `${
          describe(controller.instance.constructor)
        }.${method.name}`;
        const source: Source = { feature, controller, method, name };
        const segments = full_path([
          graph.route,
          feature.route,
          controller.route,
          method.route,
        ]).split("/");
        const path_params = segments
          .filter((segment) => segment.startsWith(":"))
          .map((segment) => segment.slice(1));
        const path = segments
          .map((s) => s.startsWith(":") ? `{${s.slice(1)}}` : s)
          .join("/");

        const id = method.doc.operationId ?? name;
        const taken = ids.get(id);
        if (taken !== undefined) {
          throw openapi_error(
            "CHO_OPENAPI_DUPLICATE_OPERATION_ID",
            `openApiDocument(): the operationId ${
              JSON.stringify(id)
            } is used by ${taken} and ${name}`,
          );
        }
        ids.set(id, name);

        const declared = [...new Set(docs.flatMap((doc) => doc.tags ?? []))];
        const controller_name = describe(controller.instance.constructor);
        const tags = declared.length > 0
          ? declared
          : [controller_name.replace(/(?<=.)Controller$/, "")];
        const security = docs.findLast((doc) => doc.security)?.security;
        if (security) {
          assert_schemes(security, name);
        }

        const operation: OpenApiOperation = {
          operationId: id,
          tags,
          ...(method.doc.summary !== undefined
            ? { summary: method.doc.summary }
            : {}),
          ...(method.doc.description !== undefined
            ? { description: method.doc.description }
            : {}),
          ...(docs.some((doc) => doc.deprecated) ? { deprecated: true } : {}),
          ...(security ? { security: to_security(security) } : {}),
          ...read_arguments(source, path_params, schemas),
          responses: read_responses(source, schemas),
        };
        (paths[path] ??= {})[verb] = operation;
      }
    }
  }

  const has_schemas = Object.keys(schemas.components).length > 0;
  const has_schemes = Object.keys(schemes).length > 0;
  return {
    openapi: "3.1.1",
    info: structuredClone(options.info),
    ...(options.servers
      ? { servers: structuredClone([...options.servers]) }
      : {}),
    ...(options.tags
      ? {
        tags: Object.entries(options.tags).map(([name, description]) => ({
          name,
          description,
        })),
      }
      : {}),
    paths,
    ...(has_schemas || has_schemes
      ? {
        components: {
          ...(has_schemas ? { schemas: schemas.components } : {}),
          ...(has_schemes
            ? { securitySchemes: structuredClone({ ...schemes }) }
            : {}),
        },
      }
      : {}),
    ...(options.security ? { security: to_security(options.security) } : {}),
    ...(options.externalDocs
      ? { externalDocs: { ...options.externalDocs } }
      : {}),
  };
}
