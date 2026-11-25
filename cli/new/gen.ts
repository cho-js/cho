/**
 * Writes the files of the tool that are made from others:
 *
 * | File                         | Made from                                   |
 * | ---------------------------- | ------------------------------------------- |
 * | `templates.gen.ts`           | `templates/`: every file of every template  |
 * | `cho.schema.json`            | `config_schema()`: the schema of `cho.json` |
 * | `../generate/templates.gen.ts` | `../generate/templates/`: every part      |
 *
 * ```sh
 * deno task --cwd cli gen
 * ```
 *
 * The three are kept in git, and `gen_test.ts` fails when one is not what
 * this would write. It is run by Deno alone: it is the build, not a part of
 * the tool.
 *
 * @module
 */

import { fileURLToPath } from "node:url";
import { PARTS } from "../generate/parts.ts";
import { config_schema, KINDS, TEMPLATE_NAMES } from "./config.ts";

const HERE = new URL("./", import.meta.url);

/** The files of a folder, by name, in the order of the names. */
async function read_folder(folder: URL): Promise<[string, string][]> {
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
function as_lines(text: string, indent: string): string {
  const lines = text.split("\n").map((line) =>
    `${indent}  ${JSON.stringify(line)},`
  );
  return `[\n${lines.join("\n")}\n${indent}].join("\\n")`;
}

let templates = `/**
 * The templates, as text: every file of \`templates/\`, by template and by
 * name.
 *
 * Written by \`gen.ts\` (\`deno task --cwd cli gen\`): do not edit it. The
 * templates are files of the repository, checked and tested there; this
 * module is how they are in the tool, on every runtime and in its bundle.
 *
 * @module
 */

import type { TemplateName } from "./config.ts";

/** The files of each template, by name. */
export const TEMPLATES: Record<TemplateName, Record<string, string>> = {
`;
for (const template of TEMPLATE_NAMES) {
  templates += `  ${template}: {\n`;
  const folder = new URL(`templates/${template}/`, HERE);
  for (const [name, text] of await read_folder(folder)) {
    templates += `    ${JSON.stringify(name)}: ${as_lines(text, "    ")},\n`;
  }
  templates += `  },\n`;
}
templates += `};\n`;

let parts = `/**
 * The templates of \`cho generate\`, as text: every file of \`templates/\`, by
 * kind of application, by part and by name.
 *
 * Written by \`../new/gen.ts\` (\`deno task --cwd cli gen\`): do not edit it.
 * The templates are files of the repository, checked and tested there; this
 * module is how they are in the tool, on every runtime and in its bundle.
 *
 * @module
 */

import type { Kind } from "../new/config.ts";
import type { Part } from "./parts.ts";

/** The files of each part, for each kind of application, by name. */
export const PART_TEMPLATES: Record<
  Kind,
  Record<Part, Record<string, string>>
> = {
`;
for (const kind of KINDS) {
  parts += `  ${kind}: {\n`;
  for (const part of PARTS) {
    parts += `    ${part}: {\n`;
    const folder = new URL(`../generate/templates/${kind}/${part}/`, HERE);
    for (const [name, text] of await read_folder(folder)) {
      parts += `      ${JSON.stringify(name)}: ${as_lines(text, "      ")},\n`;
    }
    parts += `    },\n`;
  }
  parts += `  },\n`;
}
parts += `};\n`;

const files = {
  "templates.gen.ts": templates,
  "cho.schema.json": `${JSON.stringify(config_schema(), null, 2)}\n`,
  "../generate/templates.gen.ts": parts,
};
for (const [name, text] of Object.entries(files)) {
  await Deno.writeTextFile(new URL(name, HERE), text);
}

// As the formatter would write them: a later `deno fmt` changes nothing.
const fmt = await new Deno.Command(Deno.execPath(), {
  args: [
    "fmt",
    // a path, and not the `pathname` of a URL, which is wrong on Windows
    ...Object.keys(files).map((name) => fileURLToPath(new URL(name, HERE))),
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!fmt.success) {
  Deno.exit(fmt.code);
}
console.log(Object.keys(files).join(", "));
