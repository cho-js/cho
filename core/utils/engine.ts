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
function check_user_agent(platform: string): boolean {
  const userAgent = globalThis?.navigator?.userAgent;
  return typeof userAgent === "string" && userAgent.includes(platform);
}

/**
 * Detect if the current runtime is Cloudflare Workers.
 * @see https://developers.cloudflare.com/workers/runtime-apis/web-standards/#navigatoruseragent
 */
export function is_cloudflare_rt(): boolean {
  return check_user_agent("Cloudflare-Workers");
}

/**
 * Detect if the current runtime is an Edge Runtime (like Vercel Edge Functions or Netlify Edge Functions).
 */
export function is_edge_rt(): boolean {
  return "EdgeRuntime" in globalThis;
}

/**
 * Detect if the current runtime is Deno.
 * @see https://docs.deno.com/api/web/~/Navigator.userAgent
 */
export function is_deno_rt(): boolean {
  return check_user_agent("Deno");
}

/**
 * Detect if the current runtime is Bun.
 * @see https://bun.com/reference/globals/Navigator/userAgent
 */
export function is_bun_rt(): boolean {
  return check_user_agent("Bun");
}

/**
 * Detect if the current runtime is Node.js.
 * @see https://nodejs.org/api/process.html#processrelease
 */
export function is_node_rt(): boolean {
  return check_user_agent("Node.js") ||
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
  if (is_cloudflare_rt()) {
    return "workerd";
  }

  if (is_edge_rt()) {
    return "edge";
  }

  if (is_deno_rt()) {
    return "deno";
  }

  if (is_bun_rt()) {
    return "bun";
  }

  if (is_node_rt()) {
    return "node";
  }

  return "unknown";
}
