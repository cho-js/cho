/**
 * @chojs/cli — `cho`, the command-line tool of the CHO framework.
 *
 * This is its entry point: it runs the command line of the process, and exits
 * with the code of the command. It is written for Deno, Node.js and Bun
 * alike: the command line and the exit are those of `node:process`.
 *
 * ```sh
 * deno install --global --allow-env --name cho jsr:@chojs/cli   # Deno
 * npm install --global @chojs/cli                               # Node.js
 * bun add --global @chojs/cli                                   # Bun
 *
 * cho --help
 * ```
 *
 * @module
 */

import process from "node:process";
import { run_cli } from "./app.ts";

process.exit(await run_cli(process.argv.slice(2)));
