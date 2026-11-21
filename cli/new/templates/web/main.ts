/**
 * The entry point: creates the application, and serves it.
 *
 * `serve` picks the server of the runtime: the same file runs on Deno, on
 * Node.js and on Bun.
 *
 * @module
 */

import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { AppModule } from "./app.ts";

const app = await ChoWeb.create(AppModule);
const server = await serve(app, { port: 3000 });

console.log(`__name__ is listening on http://localhost:${server.port}`);
