/**
 * The decorators of `@chojs/command`, applied with decorator **syntax**, end
 * to end.
 *
 * Every other test applies decorators as plain function calls. This file is
 * the exception: it checks that the syntax itself works on each runtime's own
 * decorator implementation (Deno, Bun, and Node.js through `tsx`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capture } from "@chojs/core/utils/test_utils";
import {
  Action,
  Catch,
  ChoCommand,
  type ChoCommandContext,
  type ChoCommandNext,
  Controller,
  Help,
  Injectable,
  Main,
  Middlewares,
  Module,
} from "./mod.ts";

const seen: string[] = [];

@Injectable()
class Clock {
  now() {
    return 42;
  }
}

@Injectable([Clock])
class Timing {
  constructor(readonly clock: Clock) {}
  async handle(ctx: ChoCommandContext, next: ChoCommandNext) {
    ctx.state.set("started", this.clock.now());
    const code = await next();
    seen.push(`timed ${ctx.command}`);
    return code;
  }
}

@Help("File commands")
@Catch((error, ctx) => {
  seen.push(`controller caught ${error} in ${ctx.command}`);
  return 3;
})
@Middlewares(Timing)
@Controller({ dependencies: [Clock] })
class Files {
  constructor(readonly clock: Clock) {}

  @Help("Copy a file")
  @Action("copy", { boolean: ["force"], alias: { f: "force" } })
  copy(ctx: ChoCommandContext) {
    seen.push(`copy ${ctx.args._.join(",")} ${ctx.args.force}`);
    return ctx.state.get("started") === this.clock.now() ? 0 : 1;
  }

  @Middlewares((ctx, next) => ctx.args.yes ? next() : 5)
  @Catch((error) => {
    seen.push(`method caught ${error}`);
    return 4;
  })
  @Action("rm")
  remove() {
    throw new Error("locked");
  }

  @Action("mv")
  move() {
    throw new Error("busy");
  }
}

@Middlewares(async (ctx, next) => {
  seen.push(`module ${ctx.command}`);
  return await next();
})
@Module({ providers: [Clock, Timing], controllers: [Files] })
class App {}

describe("decorator syntax", () => {
  const run = async (...argv: string[]) => {
    seen.length = 0;
    const app = ChoCommand.create(App, { name: "fs" });
    const { result, output } = await capture(() => app.run(argv));
    return { code: result, seen: [...seen], log: output.log.join("\n") };
  };

  it("runs a command through its middlewares, with the context", async () => {
    assert.deepEqual(await run("copy", "a", "b", "-f"), {
      code: 0,
      seen: ["module copy", "copy a,b true", "timed copy"],
      log: "",
    });
  });

  it("runs method-level middlewares and error handlers", async () => {
    assert.equal((await run("rm")).code, 5); // stopped by the method's middleware
    const failed = await run("rm", "--yes");
    assert.equal(failed.code, 4);
    assert.deepEqual(failed.seen, ["module rm", "method caught Error: locked"]);
  });

  it("falls back to the controller's error handler", async () => {
    const failed = await run("mv");
    assert.equal(failed.code, 3);
    assert.deepEqual(failed.seen, [
      "module mv",
      "controller caught Error: busy in mv",
    ]);
  });

  it("prints the help of the declared commands and flags", async () => {
    const { code, log } = await run("copy", "--help");
    assert.equal(code, 0);
    assert.match(log, /Usage: fs copy[\s\S]*Copy a file[\s\S]*-f, --force/);
    assert.match((await run()).log, /File commands:\n {2}copy {2}Copy a file/);
  });

  it("runs a single @Main command", async () => {
    @Controller()
    class Cli {
      @Main({ string: ["name"] })
      main(ctx: ChoCommandContext) {
        console.log(`hello ${ctx.args.name} from ${ctx.command}`);
      }
    }

    @Module({ controllers: [Cli] })
    class MainApp {}

    const { result, output } = await capture(() =>
      ChoCommand.create(MainApp).run(["--name", "007"])
    );
    assert.equal(result, 0);
    assert.deepEqual(output.log, ["hello 007 from main"]);
  });
});
