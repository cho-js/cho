#!/usr/bin/env -S deno run --allow-all
import { Args, ChoWeb, Controller, Get, Module, Query } from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";

@Controller({
  route: "bar",
})
export class BarController {
  @Get("")
  @Args(Query("name"))
  hello(name: string | undefined) {
    return { message: `Hello from ${name ?? "BarController"}` };
  }
}

@Module({
  route: "foo",
  controllers: [BarController],
})
export class FooModule {
}

const app = await ChoWeb.create(FooModule, { linker: new HonoLinker() });
Deno.serve({ port: 8081 }, app.handler);

// open browser and go to http://localhost:8081/foo/bar?name=you
