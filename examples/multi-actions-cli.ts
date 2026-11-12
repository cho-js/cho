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
  @Action("goodbye", {
    boolean: ["loud"],
    string: ["to"],
    alias: { l: "loud" },
    describe: { loud: "Say it louder", to: "Who to say goodbye to" },
  })
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
const code = await app.run(Deno.args);
await app.close(); // release what the application created
Deno.exit(code);

// run with ./examples/multi-actions-cli.ts goodbye --to you -l
// and ./examples/multi-actions-cli.ts goodbye --help
