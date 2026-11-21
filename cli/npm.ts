/**
 * Builds the npm package of the tool, in `cli/npm/`: what `npm install
 * --global @chojs/cli` installs, for Node.js and for Bun.
 *
 * ```sh
 * deno task --cwd cli npm
 * ```
 *
 * The packages of CHO are published to JSR, as TypeScript. A command of npm
 * has to be JavaScript, in a package with a `bin` entry, and JSR makes none.
 * So the tool is bundled, with `deno bundle`, into one JavaScript file with no
 * dependency, and gets a `package.json` that names it `cho`:
 *
 * | File           | What it is                                             |
 * | -------------- | ------------------------------------------------------ |
 * | `cho.js`       | The tool and the framework, bundled; it runs on `node` |
 * | `package.json` | Written here: the name and the version of `deno.json`  |
 * | `README.md`    | A copy                                                 |
 * | `LICENSE`      | A copy                                                 |
 *
 * The folder is not kept in git, and is not published to JSR. It is run by
 * Deno alone: it is the build, not a part of the tool.
 *
 * @module
 */

import config from "./deno.json" with { type: "json" };

/** The folder of the tool, and the folder of its npm package. */
const SOURCE = new URL("./", import.meta.url);
const TARGET = new URL("./npm/", import.meta.url);

/** The manifest of the npm package. */
const MANIFEST = {
  name: config.name,
  version: config.version,
  description: "cho, the command-line tool of the CHO framework",
  license: config.license,
  type: "module",
  bin: { cho: "cho.js" },
  files: ["cho.js"],
  // Said here, and not left to the default of the npm that publishes.
  publishConfig: { access: "public" },
  // The versions the tests of the repository run on.
  engines: { node: ">=24", bun: ">=1.3.4" },
  homepage: "https://github.com/cho-js/cho/tree/main/cli#readme",
  repository: {
    type: "git",
    url: "git+https://github.com/cho-js/cho.git",
    directory: "cli",
  },
  bugs: "https://github.com/cho-js/cho/issues",
  keywords: ["cho", "chojs", "cli"],
};

await Deno.remove(TARGET, { recursive: true }).catch(() => {});
await Deno.mkdir(TARGET);

// The bundle. The imports of `node:` stay as they are: Node.js has them.
const bundle = await new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--platform=deno",
    "--format=esm",
    `--output=${new URL("cho.js", TARGET).pathname}`,
    new URL("main.ts", SOURCE).pathname,
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!bundle.success) {
  Deno.exit(bundle.code);
}

// npm runs the file by its first line, and makes it executable when the
// package is installed.
const file = new URL("cho.js", TARGET);
await Deno.writeTextFile(
  file,
  `#!/usr/bin/env node\n${await Deno.readTextFile(file)}`,
);
await Deno.chmod(file, 0o755);

await Deno.writeTextFile(
  new URL("package.json", TARGET),
  `${JSON.stringify(MANIFEST, null, 2)}\n`,
);
for (const name of ["README.md", "LICENSE"]) {
  await Deno.copyFile(new URL(name, SOURCE), new URL(name, TARGET));
}

console.log(`${MANIFEST.name}@${MANIFEST.version}: ${TARGET.pathname}`);
