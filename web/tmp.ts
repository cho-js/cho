import {Controller, Injector, Middlewares, Module} from "@chojs/core";
import {Get, Post} from "./decorators.ts";
import {ChoWeb} from "./web.ts";


@Middlewares((_ctx, next) => { console.log('MWCC'); next() })
@Controller({
  route: "b",
})
class Controller1 {
  constructor() {
    console.log("Controller1.constructor() called");
  }
  @Middlewares((_ctx, next) => { console.log('MW'); next() })
  @Get("c")
  async g() {
    console.error(">>>>>>>>>>>>");
    return {};
  }

  @Post("pp")
  p() {
    console.error(">>>>>>>>>>>>");
    return {};
  }
}

@Module({
  route: "a",
  controllers: [Controller1],
})
class Feature1 {
}

@Module({
  imports: [Feature1],
})
class App {
}


const app = await ChoWeb.create(App, { version: "1.0.0" });

Deno.serve({ port: 8081 }, app.handler);
