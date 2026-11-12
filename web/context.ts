/**
 * Request context interface that abstracts the underlying framework's request.
 * Embrace the Hono Request interface for a unified experience.
 */
export interface RequestContext {
  raw: Request;
  path: string;
  url: string;
  method: string;

  param(): Record<string, string>;
  param(key: string): string | undefined;

  query(): Record<string, string>;
  query(key: string): string | undefined;
  queries(key: string): string[] | undefined;

  header(): Record<string, string>;
  header(key: string): string | undefined;

  /**
   * Request body as `multipart/form-data` or `application/x-www-form-urlencoded`
   */
  parseBody(): Promise<unknown>;

  /**
   * Request body as `application/json`
   */
  json(): Promise<unknown>;

  /**
   * Request body as `text/plain`
   */
  text(): Promise<unknown>;

  /**
   * Request body as ArrayBuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Request body as Blob
   */
  blob(): Promise<Blob>;

  /**
   * Request parsed as FormData
   */
  formData(): Promise<FormData>;
}

/**
 * Request context interface that abstracts the underlying framework's context.
 * Embrace the Hono ChoWebContext interface for a unified experience.
 */
export interface ChoWebContext {
  readonly req: RequestContext;
  readonly res: Response;

  /**
   * Set the response status code.
   * @param code
   */
  status(code: number): void;

  /**
   * Set a response header.
   * @param key
   * @param value
   */
  header(key: string, value: string): void;

  /**
   * Return a response with the given body, status, and headers.
   * @param content
   * @param status
   * @param headers
   */
  body(content: unknown, status?: number, headers?: Headers): Response;

  /**
   * Return a `text/plain` response with optional status and headers.
   * @param content
   * @param status
   * @param headers
   */
  text(content: string, status?: number, headers?: Headers): Response;

  /**
   * Return a `application/json` response with optional status and headers.
   * @param content
   * @param status
   * @param headers
   */
  json(content: unknown, status?: number, headers?: Headers): Response;

  /**
   * Return a `text/html` response with optional status and headers.
   * @param content
   * @param status
   * @param headers
   */
  html(content: string, status?: number, headers?: Headers): Response;

  /**
   * Return a 404 Not Found response with an optional message.
   * @param message
   */
  notFound(message?: string): Response;

  /**
   * Send a redirect response.
   * @param path
   * @param status default to 302
   */
  redirect(path: string, status?: number): void;

  /**
   * Get a value from the context that was set within the request lifecycle.
   * @param key
   */
  get(key: string): unknown;

  /**
   * Set a value in the context that can be shared within the request lifecycle.
   * @param key
   * @param value
   */
  set(key: string, value: unknown): void;
}
