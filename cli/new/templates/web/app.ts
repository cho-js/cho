/**
 * The application: its root module, and what it declares.
 *
 * Nothing runs here. `main.ts` serves the application, and the tests call its
 * handler.
 *
 * @module
 */

import { Controller, Get, Module } from "@chojs/web";

/** The routes of the root: `GET /`. */
@Controller({ route: "" })
export class HelloController {
  /** `GET /`: who answers. */
  @Get("")
  hello() {
    return { message: "Hello from __name__" };
  }
}

/** The root module of the application. */
@Module({ controllers: [HelloController] })
export class AppModule {}
