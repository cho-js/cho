#!/usr/bin/env -S deno run --allow-all
import {ChoWeb, type ChoWebContext, Controller, Get, Module} from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";

@Controller({
  route: "bar",
})
export class BarController {
  @Get("")
  hello(_ctx: ChoWebContext) {
    // console.log(_ctx);
    return { message: "Hello from BarController" };
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

// open browser and go to http://localhost:8081/foo/bar
