#! /usr/bin/env deno run --allow-env
import { Controller, Module } from "@chojs/core";
import {
  type ChoCommandContext,
  CommandFactory,
  Help,
  Main,
} from "@chojs/command";

@Controller()
class MyController {
  /**
   * @param ctx
   */
  @Help("this is the main hello command")
  @Main()
  hello(ctx: ChoCommandContext) {
    console.log("Hello");
    console.log("Arguments:", ctx.args);
    console.log("Properties:", ctx.properties);
  }
}

@Module({ controllers: [MyController] })
export class MyApp {}

const app = await CommandFactory.create(MyApp);

// await app.run(Deno.args);
await app.run(process.argv.slice(2));

// import {Get, WebFactory} from "../web/mod.ts";
// import { AppRef } from "../core/internals/app-ref.ts";
// import {HonoLinker} from "../web/linker2.ts";
// const app = await WebFactory.create(MyModule);
// Deno.serve(app.app.fetch);
// const ref = await AppRef.create(MyModule);
// const linker = new HonoLinker();
// const linked = linker.link(ref.initiated);
// console.log(app.select<MyController>(MyController).hello());
