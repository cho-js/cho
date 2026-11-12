/**
 * Detecting the JavaScript runtime the code runs on.
 *
 * The values follow the WinterCG runtime keys where one exists.
 *
 * @see https://runtime-keys.proposal.wintercg.org/
 * @module
 */

/**
 * A JavaScript runtime that {@link engine} can detect:
 *
 * - `"node"`: Node.js;
 * - `"deno"`: Deno;
 * - `"bun"`: Bun;
 * - `"workerd"`: Cloudflare Workers;
 * - `"edge"`: an edge runtime, such as Vercel Edge Functions;
 * - `"unknown"`: anything else, such as a browser.
 */
export type EngineType =
  | "node"
  | "deno"
  | "bun"
  | "workerd"
  | "edge"
  | "unknown";

/** Whether `navigator.userAgent` mentions the given platform. */
function checkUserAgent(platform: string): boolean {
  const userAgent = globalThis?.navigator?.userAgent;
  return typeof userAgent === "string" && userAgent.includes(platform);
}

/**
 * Detect if the current runtime is Cloudflare Workers.
 * @see https://developers.cloudflare.com/workers/runtime-apis/web-standards/#navigatoruseragent
 */
export function isCloudflareRt(): boolean {
  return checkUserAgent("Cloudflare-Workers");
}

/**
 * Detect if the current runtime is an Edge Runtime (like Vercel Edge Functions or Netlify Edge Functions).
 */
export function isEdgeRt(): boolean {
  return "EdgeRuntime" in globalThis;
}

/**
 * Detect if the current runtime is Deno.
 * @see https://docs.deno.com/api/web/~/Navigator.userAgent
 */
export function isDenoRt(): boolean {
  return checkUserAgent("Deno");
}

/**
 * Detect if the current runtime is Bun.
 * @see https://bun.com/reference/globals/Navigator/userAgent
 */
export function isBunRt(): boolean {
  return checkUserAgent("Bun");
}

/**
 * Detect if the current runtime is Node.js.
 * @see https://nodejs.org/api/process.html#processrelease
 */
export function isNodeRt(): boolean {
  return checkUserAgent("Node.js") ||
    globalThis.process?.release?.name === "node";
}

/**
 * Detect the JavaScript runtime the code runs on.
 *
 * Runtimes that emulate others are checked first: Cloudflare Workers and edge
 * runtimes can expose Node.js globals, and Bun and Deno expose `process`.
 *
 * @returns The detected runtime, or `"unknown"`.
 *
 * @example
 * ```ts
 * import { engine } from "@chojs/core/utils";
 *
 * if (engine() === "deno") {
 *   // ...
 * }
 * ```
 */
export function engine(): EngineType {
  if (isCloudflareRt()) {
    return "workerd";
  }

  if (isEdgeRt()) {
    return "edge";
  }

  if (isDenoRt()) {
    return "deno";
  }

  if (isBunRt()) {
    return "bun";
  }

  if (isNodeRt()) {
    return "node";
  }

  return "unknown";
}
