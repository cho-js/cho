export type EngineTpe =
  | "node"
  | "deno"
  | "bun"
  | "cloudflare"
  | "edge"
  | "unknown";

/**
 * Detect if the current runtime is Cloudflare Workers.
 * @see https://developers.cloudflare.com/workers/runtime-apis/web-standards/#navigatoruseragent
 */
export function isCloudflare(): boolean {
  return globalThis?.navigator?.userAgent === "Cloudflare-Workers";
}

/**
 * Detect if the current runtime is an Edge Runtime (like Vercel Edge Functions or Netlify Edge Functions).
 */
export function isEdge(): boolean {
  return "EdgeRuntime" in globalThis;
}

/**
 * Detect if the current runtime is Deno.
 */
export function isDeno(): boolean {
  return "Deno" in globalThis;
}

/**
 * Detect if the current runtime is Bun.
 */
export function isBun(): boolean {
  return "Bun" in globalThis;
}

/**
 * Detect if the current runtime is Node.js.
 */
export function isNode(): boolean {
  return globalThis.process?.release?.name === "node";
}

/**
 * Detect the current JavaScript runtime engine.
 * @returns {EngineTpe} The detected engine type.
 */
export function engine(): EngineTpe {
  if (isCloudflare()) {
    return "cloudflare";
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

