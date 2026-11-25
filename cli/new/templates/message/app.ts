/**
 * The application: its root module, and the topics it handles.
 *
 * Nothing runs here. `main.ts` connects the application to Kafka, and the
 * tests give it messages of their own.
 *
 * @module
 */

import {
  type ChoMessageContext,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";

/** The handlers of the topics of `__name__`. */
@Controller({ topic: "__name__" })
export class HelloController {
  /** The topic `__name__.hello`: a message such as `{"name":"Ada"}`. */
  @Subscribe("hello")
  hello(ctx: ChoMessageContext) {
    const message = ctx.json<{ name?: string }>();
    console.log(`Hello, ${message?.name ?? "world"}!`);
    // returning without an error: the message is handled
  }
}

/** The root module of the application. */
@Module({ controllers: [HelloController] })
export class AppModule {}
