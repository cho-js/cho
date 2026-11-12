#!/usr/bin/env -S deno run --allow-all
import { Action, ChoCommand, Controller, Help, Module } from "@chojs/command";
import type { ChoArgs } from "@chojs/command";

@Help("Multi-action CLI example")
@Controller()
export class MultiActionController {
  @Help("Hello world action")
  @Action("hello")
  sayHello(ctx: ChoArgs) {
    console.log("Hello");
    console.log("argument used in this run:", ctx);
  }

  @Help("Goodbye world action")
  @Action("goodbye")
  sayGoodbye(ctx: ChoArgs) {
    console.log("Goodbye");
    console.log("argument used in this run:", ctx);
  }
}

@Module({ controllers: [MultiActionController] })
export class MultiActionApp {}

const app = await ChoCommand.create(MultiActionApp, {
  name: "multi-action",
  version: "0.1.0",
});
Deno.exit(await app.run(Deno.args));

// run with ./examples/multi-actions-cli.ts goodbye --foo bar
