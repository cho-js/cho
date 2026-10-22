#! /usr/bin/env deno run --allow-env
import { Controller, Module } from "@chojs/core";
import {
  type ChoCommandContext,
  Command,
  CommandFactory,
  Help,
} from "@chojs/command";

/**
 * Running multiple commands example:
 *
 * ```shell
 * ./example/cli-commands-example.ts hello
 * ./example/cli-commands-example.ts goodbye
 * ```
 *
 * Add arguments and properties (the route is not part of the arguments list):
 *
 * ```shell
 * ./example/cli-commands-example.ts hello arg1 arg2 --prop1=value1 --prop2=42 -abc
 * ```
 *
 * ## Prerequisites
 *
 * ### Using Deno
 *
 * 1. Deno installed.
 * 2. Make sure the script is executable:
 * ```shell
 * chmod +x ./example/cli-commands-example.ts
 * ```
 */
@Controller()
class MyController {
  @Help("this is the hello command")
  @Command("hello")
  hello(ctx: ChoCommandContext) {
    console.log("Hello");
    console.log("Arguments:", ctx.args);
    console.log("Properties:", ctx.properties);
  }

  @Help("this is the goodbye command")
  @Command("goodbye")
  goodbye(ctx: ChoCommandContext) {
    console.log("Goodbye");
    console.log("Arguments:", ctx.args);
    console.log("Properties:", ctx.properties);
  }
}

@Module({ controllers: [MyController] })
export class MyApp {}

const app = await CommandFactory.create(MyApp);
await app.run(Deno.args);
