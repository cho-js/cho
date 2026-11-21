/**
 * The application: its root module, and the commands it declares.
 *
 * Nothing runs here. `main.ts` runs the command line of the process, and the
 * tests run command lines of their own.
 *
 * @module
 */

import {
  Action,
  type ChoCommandContext,
  Controller,
  Help,
  Module,
} from "@chojs/command";

/** The commands of the tool. */
@Controller()
export class HelloCommands {
  /** `hello`, and `hello --name Ada`. */
  @Help("Say hello")
  @Action("hello", {
    string: ["name"],
    describe: { name: "Who to say hello to" },
  })
  hello(ctx: ChoCommandContext) {
    console.log(`Hello, ${ctx.args.name ?? "world"}!`);
  }
}

/** The root module of the application. */
@Module({ controllers: [HelloCommands] })
export class AppModule {}
