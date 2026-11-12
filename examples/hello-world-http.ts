#!/usr/bin/env -S deno run --allow-all
import { ChoWeb, Controller, Get, Module } from "@chojs/web";

@Controller({
  route: "bar",
})
export class BarController {
  @Get("")
  hello() {
    return { message: "Hello from BarController" };
  }
}

@Module({
  route: "foo",
  controllers: [BarController],
})
export class FooModule {
}

const app = await ChoWeb.create(FooModule);
Deno.serve({ port: 8081 }, app.handler);

// open browser and go to http://localhost:8081/foo/bar
