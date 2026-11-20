/**
 * Bundles one file as a Worker, and writes the configuration `workerd test`
 * runs it with.
 *
 *     node build.mjs <repo> <file> [test|worker]
 *
 * - `test` (the default): `<file>` is a test file of the repository. Its
 *   `node:test` is the stand-in of this folder, and the Worker runs what the
 *   file declared.
 * - `worker`: `<file>` is a Worker with a `test` handler of its own, as the
 *   ones of `workers/`. It runs with no `nodejs_compat`.
 *
 * It is run from a folder that has esbuild installed, with this file and
 * `test-api.js` in it: `run.sh` makes one.
 */
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** The compatibility date of the Workers: the one the documents name. */
const COMPATIBILITY_DATE = process.env.COMPATIBILITY_DATE ?? "2025-09-01";

const [repo, file, mode = "test"] = process.argv.slice(2);
const here = import.meta.dirname;
const source = resolve(repo, file);

let entry = source;
if (mode === "test") {
  entry = resolve(here, "entry.js");
  writeFileSync(
    entry,
    `import { run_collected } from "node:test";
import ${JSON.stringify(source)};
export default {
  async test() {
    const result = await run_collected();
    for (const line of result.lines) console.log(line);
    console.log("RESULT " + JSON.stringify({
      file: ${JSON.stringify(file)},
      pass: result.pass,
      fail: result.fail,
      skip: result.skip,
    }));
  },
};
`,
  );
}

/** Fastify runs on Node.js only: its adapter is left out of a bundle. */
const without_fastify = {
  name: "without-fastify",
  setup(build) {
    build.onResolve({ filter: /vendor\/fastify\/mod\.ts$/ }, () => ({
      path: "fastify-adapter",
      namespace: "left-out",
    }));
    build.onLoad({ filter: /.*/, namespace: "left-out" }, () => ({
      contents: "export const FastifyLinker = undefined;",
    }));
  },
};

await build({
  entryPoints: [entry],
  outfile: resolve(here, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // The names of functions and classes are in error messages, in logs and
  // in the tags of an OpenAPI document.
  keepNames: true,
  mainFields: ["module", "main"],
  conditions: ["worker", "workerd", "import", "default"],
  tsconfig: resolve(repo, "tsconfig.json"),
  alias: {
    "node:test": resolve(here, "test-api.js"),
    "@chojs/vendor-cho": resolve(repo, "vendor/cho/mod.ts"),
    "@chojs/vendor-hono": resolve(repo, "vendor/hono/mod.ts"),
    "@chojs/openapi": resolve(repo, "extras/openapi/mod.ts"),
    "@chojs/dev": resolve(repo, "extras/dev/mod.ts"),
  },
  external: ["node:*", "cloudflare:*"],
  plugins: [without_fastify],
  logLevel: "error",
});

const flags = mode === "test" ? ['"nodejs_compat"'] : [];
writeFileSync(
  resolve(here, "config.capnp"),
  `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ (name = "main", worker = .worker) ],
);

const worker :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "bundle.js") ],
  compatibilityDate = "${COMPATIBILITY_DATE}",
  compatibilityFlags = [${flags.join(", ")}],
  bindings = [ (name = "GREETING", text = "hello from a binding") ],
);
`,
);
