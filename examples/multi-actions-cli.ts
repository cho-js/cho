#!/usr/bin/env -S deno run --allow-all
import {
  Action,
  Catch,
  ChoCommand,
  type ChoCommandContext,
  Controller,
  Help,
  Middlewares,
  Module,
} from "@chojs/command";

@Help("Multi-action CLI example")
// runs around every command of the controller
@Middlewares(async (ctx, next) => {
  console.error(`> ${ctx.command}`);
  await next();
})
// handles what a command throws; its result is the exit code
@Catch((error, ctx) => {
  console.error(`${ctx.command} failed: ${error}`);
  return 2;
})
@Controller()
export class MultiActionController {
  @Help("Hello world action")
  @Action("hello")
  sayHello(ctx: ChoCommandContext) {
    console.log("Hello");
    console.log("arguments used in this run:", ctx.args);
  }

  @Help("Goodbye world action")
  @Action("goodbye", {
    boolean: ["loud"],
    string: ["to"],
    alias: { l: "loud" },
    describe: { loud: "Say it louder", to: "Who to say goodbye to" },
  })
  sayGoodbye(ctx: ChoCommandContext) {
    if (!ctx.args.to) {
      throw new Error("--to is required");
    }
    const text = `Goodbye, ${ctx.args.to}`;
    console.log(ctx.args.loud ? text.toUpperCase() + "!" : text);
  }
}

@Module({ controllers: [MultiActionController] })
export class MultiActionApp {}

const app = ChoCommand.create(MultiActionApp, {
  name: "multi-action",
  version: "0.1.0",
});
const code = await app.run(Deno.args);
await app.close(); // release what the application created
Deno.exit(code);

// run with ./examples/multi-actions-cli.ts goodbye --to you -l
// and ./examples/multi-actions-cli.ts goodbye --help
