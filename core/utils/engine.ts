/**
 * Utility functions to detect the JavaScript runtime engine.
 * @see https://runtime-keys.proposal.wintercg.org/
 */

/**
 * Type representing different JavaScript runtime engines.
 */
export type EngineTpe =
  | "node"
  | "deno"
  | "bun"
  | "worked" // cloudflare workers
  | "edge" // Vercel Edge Functions
  | "unknown";

function checkUserAgent(platform: string): boolean {
  const userAgent = globalThis?.navigator?.userAgent;
  return typeof userAgent === "string" && userAgent.includes(platform);
}

/**
 * Detect if the current runtime is Cloudflare Workers.
 * @see https://developers.cloudflare.com/workers/runtime-apis/web-standards/#navigatoruseragent
 */
export function isCloudflare(): boolean {
  return checkUserAgent("Cloudflare-Workers");
}

/**
 * Detect if the current runtime is an Edge Runtime (like Vercel Edge Functions or Netlify Edge Functions).
 */
export function isEdge(): boolean {
  return "EdgeRuntime" in globalThis;
}

/**
 * Detect if the current runtime is Deno.
 * @see https://docs.deno.com/api/web/~/Navigator.userAgent
 */
export function isDeno(): boolean {
  return checkUserAgent("Deno");
}

/**
 * Detect if the current runtime is Bun.
 * @see https://bun.com/reference/globals/Navigator/userAgent
 */
export function isBun(): boolean {
  return checkUserAgent("Bun");
}

/**
 * Detect if the current runtime is Node.js.
 * @see https://nodejs.org/api/process.html#processrelease
 */
export function isNode(): boolean {
  return checkUserAgent("Node.js") ||
    globalThis.process?.release?.name === "node";
}

/**
 * Detect the current JavaScript runtime engine.
 * @returns {EngineTpe} The detected engine type.
 */
export function engine(): EngineTpe {
  if (isCloudflare()) {
    return "worked";
  }

  if (isEdge()) {
    return "edge";
  }

  if (isDeno()) {
    return "deno";
  }

  if (isBun()) {
    return "bun";
  }

  if (isNode()) {
    return "node";
  }

  return "unknown";
}
