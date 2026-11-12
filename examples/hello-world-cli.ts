#!/usr/bin/env -S deno run --allow-all
import type {ChoArgs} from "@chojs/command";
import {ChoCommand, Controller, Help, Main, Module,} from "@chojs/command";

// @Injectable()
// export class Timing {
//   async handle(ctx: ChoCliContext, next: ChoCliNext) {
//     const start = performance.now();
//     await next();
//     const end = performance.now() - start;
//     console.log(`...`);
//   }
// }
//
// @Module({
//   providers: [Timing],
//   exports: [Timing],
// })
// export class TimingModule {}

@Help("Hello world CLI example")
@Controller()
export class HelloController {
  @Help("Hello world CLI")
  @Main()
  sayHello(ctx: ChoArgs) {
    console.log("Hello");
    console.log("argument used in this run:", ctx);
  }
}

@Module({ controllers: [HelloController] })
export class HelloApp {}

const app = await ChoCommand.create(HelloApp, {
  name: "hello",
  version: "0.1.0",
});
const code = await app.run(Deno.args);
await app.close(); // release what the application created
Deno.exit(code);

// run with ./examples/hello-world-cli.ts --foo bar
