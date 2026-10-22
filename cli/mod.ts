#!/usr/bin/env deno run --allow-read --allow-write --allow-net --allow-env
import { Application } from "../command/application.ts";
import { CLIModule } from "./cli-module.ts";

const app = await Application.create(CLIModule);
await app.run(Deno.args);
