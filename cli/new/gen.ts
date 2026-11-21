/**
 * Writes the files of the tool that are made from others:
 *
 * | File               | Made from                                    |
 * | ------------------ | -------------------------------------------- |
 * | `templates.gen.ts` | `templates/`: every file of every kind       |
 * | `cho.schema.json`  | `config_schema()`: the schema of `cho.json`  |
 *
 * ```sh
 * deno task --cwd cli gen
 * ```
 *
 * Both are kept in git, and `gen_test.ts` fails when one is not what this
 * would write. It is run by Deno alone: it is the build, not a part of the
 * tool.
 *
 * @module
 */

import { config_schema, KINDS } from "./config.ts";

const HERE = new URL("./", import.meta.url);

/** The files of the template of a kind, by name, in the order of the names. */
async function read_template(kind: string): Promise<[string, string][]> {
  const folder = new URL(`templates/${kind}/`, HERE);
  const names: string[] = [];
  for await (const entry of Deno.readDir(folder)) {
    if (entry.isFile) {
      names.push(entry.name);
    }
  }
  names.sort();
  return Promise.all(
    names.map(async (name) =>
      [name, await Deno.readTextFile(new URL(name, folder))] as [string, string]
    ),
  );
}

/** The text of a file, as an expression: its lines, joined. */
function as_lines(text: string): string {
  const lines = text.split("\n").map((line) =>
    `      ${JSON.stringify(line)},`
  );
  return `[\n${lines.join("\n")}\n    ].join("\\n")`;
}

let templates = `/**
 * The templates, as text: every file of \`templates/\`, by kind and by name.
 *
 * Written by \`gen.ts\` (\`deno task --cwd cli gen\`): do not edit it. The
 * templates are files of the repository, checked and tested there; this
 * module is how they are in the tool, on every runtime and in its bundle.
 *
 * @module
 */

import type { Kind } from "./config.ts";

/** The files of the template of each kind, by name. */
export const TEMPLATES: Record<Kind, Record<string, string>> = {
`;
for (const kind of KINDS) {
  templates += `  ${kind}: {\n`;
  for (const [name, text] of await read_template(kind)) {
    templates += `    ${JSON.stringify(name)}: ${as_lines(text)},\n`;
  }
  templates += `  },\n`;
}
templates += `};\n`;

const files = {
  "templates.gen.ts": templates,
  "cho.schema.json": `${JSON.stringify(config_schema(), null, 2)}\n`,
};
for (const [name, text] of Object.entries(files)) {
  await Deno.writeTextFile(new URL(name, HERE), text);
}

// As the formatter would write them: a later `deno fmt` changes nothing.
const fmt = await new Deno.Command(Deno.execPath(), {
  args: [
    "fmt",
    ...Object.keys(files).map((name) => new URL(name, HERE).pathname),
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!fmt.success) {
  Deno.exit(fmt.code);
}
console.log(Object.keys(files).join(", "));
