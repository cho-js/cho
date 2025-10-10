import nodeTest from "node:test";

// Deno & Bun supports the same test API as Node.js
// so we can just re-export it for consistency across runtimes
export const test = nodeTest as typeof nodeTest;
