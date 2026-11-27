/**
 * The types of an OpenAPI 3.1 document, as far as `@chojs/openapi` writes
 * one. They are plain objects, and none is read-only: an application can
 * change a document before it serves it.
 *
 * @module
 */

import type { JsonSchema } from "@chojs/core/utils";

// A JSON Schema, as a plain object: the type of the core, which turns the
// validators of an application into schemas.
export type { JsonSchema };

/** The Info Object: what the API is. */
export type OpenApiInfo = {
  /** The title of the API. */
  title: string;
  /** The version of the API, not of OpenAPI: `"1.0.0"`. */
  version: string;
  /** One line about the API. */
  summary?: string;
  /** A longer text. Markdown is allowed. */
  description?: string;
  /** The URL of the terms of service. */
  termsOfService?: string;
  /** Who to contact. */
  contact?: { name?: string; url?: string; email?: string };
  /** The license of the API. */
  license?: { name: string; identifier?: string; url?: string };
};

/** A Server Object: where the API is served. */
export type OpenApiServer = {
  /** The URL of the server. It can have `{variables}`. */
  url: string;
  /** What the server is. */
  description?: string;
  /** The variables of the URL. */
  variables?: Record<
    string,
    { default: string; enum?: string[]; description?: string }
  >;
};

/** A Security Scheme Object: a way to authenticate. */
export type OpenApiSecurityScheme = {
  /** The kind of the scheme. */
  type: "apiKey" | "http" | "mutualTLS" | "oauth2" | "openIdConnect";
  /** What the scheme is. */
  description?: string;
  /** `apiKey`: the name of the header, of the query parameter or of the cookie. */
  name?: string;
  /** `apiKey`: where the key is. */
  in?: "query" | "header" | "cookie";
  /** `http`: the scheme of the `Authorization` header, such as `"bearer"`. */
  scheme?: string;
  /** `http`, with `"bearer"`: how the token is formatted, such as `"JWT"`. */
  bearerFormat?: string;
  /** `oauth2`: the flows. */
  flows?: Record<string, unknown>;
  /** `openIdConnect`: the URL of the discovery document. */
  openIdConnectUrl?: string;
};

/**
 * A Security Requirement Object: the name of a security scheme, and the
 * scopes it needs (an empty list when it has none).
 */
export type OpenApiSecurityRequirement = Record<string, string[]>;

/** An External Documentation Object. */
export type OpenApiExternalDocs = {
  /** The URL of the documentation. */
  url: string;
  /** What it is. */
  description?: string;
};

/** A Parameter Object: a parameter of the path, of the query or a header. */
export type OpenApiParameter = {
  /** The name of the parameter. */
  name: string;
  /** Where it is. */
  in: "path" | "query" | "header";
  /** Whether a request must have it. Always `true` in the path. */
  required?: boolean;
  /** Its schema. */
  schema: JsonSchema;
};

/** A Media Type Object: the schema of a body, for one media type. */
export type OpenApiMediaType = {
  /** The schema of the body. */
  schema?: JsonSchema;
};

/** A Request Body Object. */
export type OpenApiRequestBody = {
  /** Whether a request must have a body. */
  required?: boolean;
  /** The body, by media type. */
  content: Record<string, OpenApiMediaType>;
};

/** A Response Object. */
export type OpenApiResponse = {
  /** What the response means. */
  description: string;
  /** The body, by media type. */
  content?: Record<string, OpenApiMediaType>;
};

/** An Operation Object: one handler of the application. */
export type OpenApiOperation = {
  /** The id of the operation, unique in the document. */
  operationId: string;
  /** The tags of the operation. */
  tags?: string[];
  /** One line about the operation. */
  summary?: string;
  /** A longer text. */
  description?: string;
  /** Whether it should no longer be used. */
  deprecated?: boolean;
  /** What it requires, when it differs from the document: `[]` is nothing. */
  security?: OpenApiSecurityRequirement[];
  /** The parameters of the path, of the query, and the headers. */
  parameters?: OpenApiParameter[];
  /** The body of the request. */
  requestBody?: OpenApiRequestBody;
  /** The responses, by status. */
  responses: Record<string, OpenApiResponse>;
};

/** The HTTP methods of a Path Item Object. */
export type OpenApiMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch";

/** A Path Item Object: the operations of one path, by method. */
export type OpenApiPathItem = Partial<Record<OpenApiMethod, OpenApiOperation>>;

/** An OpenAPI 3.1 document. */
export type OpenApiDocument = {
  /** The version of OpenAPI. */
  openapi: "3.1.1";
  /** What the API is. */
  info: OpenApiInfo;
  /** Where the API is served. */
  servers?: OpenApiServer[];
  /** The operations, by path. */
  paths: Record<string, OpenApiPathItem>;
  /** What the document refers to. */
  components?: {
    /** The schemas the operations refer to. */
    schemas?: Record<string, JsonSchema>;
    /** The ways to authenticate. */
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
  };
  /** What every operation requires, unless it says otherwise. */
  security?: OpenApiSecurityRequirement[];
  /** The tags that have a description. */
  tags?: { name: string; description?: string }[];
  /** More documentation. */
  externalDocs?: OpenApiExternalDocs;
};
