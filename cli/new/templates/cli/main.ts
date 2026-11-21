/**
 * The entry point: runs the command line of the process, and exits with the
 * code of the command.
 *
 * The command line and the exit are those of `node:process`: the same file
 * runs on Deno, on Node.js and on Bun.
 *
 * @module
 */

import process from "node:process";
import { ChoCommand } from "@chojs/command";
import { AppModule } from "./app.ts";

const app = ChoCommand.create(AppModule, {
  name: "__name__",
  version: "0.1.0",
});
const code = await app.run(process.argv.slice(2));
await app.close(); // releases what the application created
process.exit(code);
