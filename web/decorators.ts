import type { Any, ClassMethodDecorator, Target } from "@chojs/core";
import { addToMetadataObject } from "@chojs/core/meta";
import { InputFactory } from "./types.ts";

/**
 * Function signature for method decorators that define HTTP endpoints.
 */
export type MethodDecoratorFn<R = string> = (
  route: R,
  args?: InputFactory[],
) => Any; // ClassMethodDecorator;

export type MethodExtendedDecoratorFn<R = string> = (
  route: R,
  method?: string,
) => Any; // ClassMethodDecorator;
/**
 * Extracts the name from the decorator context.
 * Supports both TC39 stage 3 and TS experimental decorators.
 *
 * @param context
 */
function nameFromContext(context: unknown): string {
  if (
    typeof context === "string"
  ) {
    return context;
  } else if (
    typeof context === "object" && null !== context && "name" in context
  ) {
    return (context as any).name;
  }
  throw new Error("Unsupported decorator context");
}

/**
 * Creates a method decorator for the given HTTP method.
 *
 * Why the decorator function check the context type?
 * Because there are two different decorator proposals:
 * - TC39 stage 3 proposal (ESM/Deno/TS > 5.0)
 * - TS experimental decorators (Bun, Experimental TS decorators, reflect-metadata, etc.)
 *
 * They have different context types.
 *
 * @param type HTTP method type (GET, POST, etc.)
 * @return {MethodDecoratorFn}
 */
function createMethodDecorator<R = string>(
  type: string,
): MethodDecoratorFn<R> {
  return function (
    route: R,
    args: InputFactory[] = [],
  ): ClassMethodDecorator {
    return function (target, context) {
      const name = nameFromContext(context);
      addToMetadataObject(target, { name, route, type, args });
    };
  };
}

/**
 * Creates a method decorator for extended HTTP methods like WebSocket, SSE, Stream, etc.
 * The method defaults to GET but can be overridden if needed.
 *
 * @param type
 */
function createExtendedMethodDecorator(
  type: string,
): MethodExtendedDecoratorFn<string> {
  return function (route: string, method = "GET"): ClassMethodDecorator {
    return function (target, context) {
      const name = nameFromContext(context);
      addToMetadataObject(target, { name, route, type, method });
    };
  };
}

/**
 * Define a method arguments list.
 * Used instead of calling the second argument of HTTP method decorators.
 *
 * @example without Args:
 * ```ts
 * class MyController {
 *  @Get("items", [
 *   Query("page"),
 *   Query("limit"),
 *  ])
 *  getItems(page: number, limit: number) { ... }
 *  }
 * ```
 *
 * @example with Args:
 * ```ts
 * class MyController {
 * @Get("items")
 * @Args(Query("page"), Query("limit"))
 * getItems(page: number, limit: number) { ... }
 * }
 * ```
 * @param args
 * @constructor
 */
export function Args(...args: InputFactory[]): ClassMethodDecorator & Any {
  return (target: Target) => {
    addToMetadataObject(target, { args });
  };
}

// HTTP Method decorators

/**
 * Method decorator for HTTP GET requests.
 *
 * @example
 * ```ts
 * class MyController {
 *   @Get("items")
 *   getItems() { ... }
 * }
 * ```
 */
export const Get: MethodDecoratorFn = createMethodDecorator("GET");
/**
 * Method decorator for HTTP POST requests.
 *
 * @example
 * ```ts
 * class UserController {
 *   @Post("users", [
 *      Body()
 *   ])
 *   createUser(userData: CreateUserDto) { ... }
 * }
 * ```
 */
export const Post: MethodDecoratorFn = createMethodDecorator("POST");

/**
 * Method decorator for HTTP PUT requests.
 *
 * @example
 * ```ts
 * class UserController {
 *   @Put("users/:id", [
 *      Params("id"),
 *      Body(),
 *   ])
 *   updateUser(id: string, userData: UpdateUserDto) { ... }
 * }
 * ```
 */
export const Put: MethodDecoratorFn = createMethodDecorator("PUT");

/**
 * Method decorator for HTTP DELETE requests.
 *
 * @example
 * ```ts
 * class UserController {
 *   @Delete("users/:id", [
 *      Params("id"),
 *   ])
 *   deleteUser(id: string) { ... }
 * }
 * ```
 */
export const Delete: MethodDecoratorFn = createMethodDecorator("DELETE");

/**
 * Method decorator for HTTP PATCH requests.
 *
 * @example
 * ```ts
 * class UserController {
 *   @Patch("users/:id", [Params("id"), Body()])
 *   patchUser(id: string, patches: Partial<User>) { ... }
 * }
 * ```
 */
export const Patch: MethodDecoratorFn = createMethodDecorator("PATCH");

// Other HTTP decorators

/**
 * Method decorator for WebSocket endpoints.
 *
 * todo temporary removed until implementation is ready
 *   should be implemented as a transport layer module
 * @example
 * ```ts
 * class ChatController {
 *   @WebSocket("chat/:room", [Params("room")])
 *   handleChat(socket: WebSocket, roomId: string) { ... }
 * }
 * ```
 */
// export const WebSocket: MethodDecoratorFn = createExtendedMethodDecorator("WS");

/**
 * Method decorator for Server-Sent Events (SSE) endpoints.
 *
 * @example
 * ```ts
 * class MyController {
 *   @Sse("events")
 *   streamEvents(stream, context) { ... }
 * }
 * ```
 */
export const Sse: MethodExtendedDecoratorFn = createExtendedMethodDecorator(
  "SSE",
);

/**
 * Method decorator for Server-Sent Events (SSE) endpoints.
 *
 * @example
 * ```ts
 * class MyController {
 *   @Sse("events")
 *   streamEvents(stream, context) { ... }
 * }
 * ```
 */
export const SseAsync: MethodExtendedDecoratorFn =
  createExtendedMethodDecorator(
    "SSE_ASYNC",
  );

/**
 * Method decorator for streaming endpoints.
 * This stream method take Unit8Array chunks and writes them to the response as they are produced.
 *
 * @example
 * ```ts
 * class DataController {
 *   @Stream("data/export")
 *   exportData(stream: WritableStream) { ... }
 * }
 * ```
 */
export const Stream: MethodExtendedDecoratorFn = createExtendedMethodDecorator(
  "STREAM",
);

/**
 * Method decorator for streaming endpoints.
 * This stream should return an async iterator that yields Unit8Array chunks to be written to the response.
 *
 * @example
 * ```ts
 * class DataController {
 *  @StreamAsync("data/async")
 *   async *streamAsyncData() {
 *     for (let i = 0; i < 10; i++) {
 *       yield new TextEncoder().encode(`Chunk ${i}\n`);
 *       await new Promise((res) => setTimeout(res, 1000));
 *     }
 *   }
 * }
 *       ```
 */
export const StreamAsync: MethodExtendedDecoratorFn =
  createExtendedMethodDecorator(
    "STREAM_ASYNC",
  );

/**
 * Method decorator for text streaming endpoints.
 * This stream method take string chunks and writes them to the response as they are produced.
 *
 * @example
 * ```ts
 * class DataController {
 *   @StreamText("data/logs")
 *   streamLogs(stream: WritableStream) { ... }
 * }
 * ```
 */
export const StreamText: MethodExtendedDecoratorFn =
  createExtendedMethodDecorator(
    "STREAM_TEXT",
  );

/**
 * Method decorator for text streaming endpoints.
 * This stream should return an async iterator that yields string chunks to be written to the response.
 *
 * @example
 * ```ts
 * class DataController {
 *   @StreamAsyncText("data/async-text")
 *     async *streamAsyncTextData() {
 *       for (let i = 0; i < 10; i++) {
 *         yield `Line ${i}\n`;
 *         await new Promise((res) => setTimeout(res, 1000));
 *       }
 *    }
 * }
 * ```
 */
export const StreamTextAsync: MethodExtendedDecoratorFn =
  createExtendedMethodDecorator(
    "STREAM_TEXT_ASYNC",
  );

/**
 * Method decorator for streaming endpoints that pipe from a ReadableStream.
 * This method should return a ReadableStream to be piped to the response.
 *
 * @example
 * ```ts
 * class FileController {
 *   @StreamPipe("files/download")
 *   downloadFile(): ReadableStream {
 *     const fileStream = getFileStreamSomehow();
 *     return fileStream;
 *   }
 * }
 * ```
 */
export const StreamPipe: MethodExtendedDecoratorFn =
  createExtendedMethodDecorator(
    "STREAM_PIPE",
  );
