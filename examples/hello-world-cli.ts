#!/usr/bin/env -S deno run --allow-all
import {
  type ChoCliContext,
  type ChoCliNext,
  ChoCommand,
  Controller,
  Help,
  Injectable,
  Main,
  Middlewares,
  Module,
} from "@chojs/command";

/** A middleware class: reports how long the command took, on stderr. */
@Injectable()
export class Timing {
  async handle(ctx: ChoCliContext, next: ChoCliNext) {
    const start = performance.now();
    const code = await next();
    const ms = Math.round(performance.now() - start);
    console.error(`${ctx.command} took ${ms}ms and exited ${code}`);
    return code;
  }
}

@Help("Hello world CLI example")
@Middlewares(Timing)
@Controller()
export class HelloController {
  @Help("Hello world CLI")
  @Main({ string: ["name"], describe: { name: "Who to greet" } })
  sayHello(ctx: ChoCliContext) {
    console.log(`Hello, ${ctx.args.name ?? "world"}!`);
    console.log("arguments used in this run:", ctx.args);
  }
}

@Module({ providers: [Timing], controllers: [HelloController] })
export class HelloApp {}

const app = ChoCommand.create(HelloApp, {
  name: "hello",
  version: "0.1.0",
});
const code = await app.run(Deno.args);
await app.close(); // release what the application created
Deno.exit(code);

// run with ./examples/hello-world-cli.ts --name you
