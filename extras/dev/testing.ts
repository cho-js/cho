/**
 * What the tests of `@chojs/dev` share: a small shop, declared with the real
 * decorators of `@chojs/web`, `@chojs/message` and `@chojs/command`, and what
 * creates an application of it. Not published.
 *
 * Decorators are applied as plain function calls.
 *
 * @module
 */

import {
  ChoWeb,
  Controller,
  Get,
  Injectable,
  Middlewares,
  Module,
  Post,
  provider,
  Sse,
  token,
  Ws,
  WsMessage,
  WsOpen,
} from "@chojs/web";
import {
  ChoMessage,
  contract,
  Controller as MessageController,
  Subscribe,
} from "@chojs/message";
import type { Linked, Linker, Route } from "@chojs/message/linker";
import { Action, Controller as CommandController } from "../../command/mod.ts";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { TestLinker } from "../../web/testing.ts";

/** A class, with any constructor. */
// deno-lint-ignore no-explicit-any
export type Class = new (...args: any[]) => object;

/** A class with a given name: two calls give two classes. */
export function named(name: string): Class {
  return ({ [name]: class {} })[name] as Class;
}

/** A middleware of the shop: its name is what the tools show. */
export async function auth(_ctx: unknown, next: () => Promise<unknown>) {
  return await next();
}

/** Another one, on one method. */
export async function audit(_ctx: unknown, next: () => Promise<unknown>) {
  return await next();
}

/** The classes of the shop, for the assertions. */
export type Shop = {
  App: Class;
  SharedModule: Class;
  UsersModule: Class;
  OrdersModule: Class;
  ChatModule: Class;
  ToolsModule: Class;
  Logger: Class;
  UsersService: Class;
  OrdersService: Class;
  /** What was created: it stays empty, whatever a tool reads. */
  created: string[];
};

/**
 * A shop, of five modules:
 *
 * - `SharedModule`: `CONFIG` (a token), `Logger`; it exports both;
 * - `UsersModule` (route `v1`): `UsersService`, and `UsersController`
 *   (`users`, with the `auth` middleware): `GET`, `GET :id`, and `POST` with
 *   the `audit` middleware; it exports `UsersService`;
 * - `OrdersModule`: `OrdersService` injects `UsersService` and `CONFIG`;
 *   `OrdersEvents` (topic `orders`) handles `orders.paid`, and
 *   `orders.refunded` by a contract; `OrdersFeed` streams `GET feed`;
 * - `ChatModule`: `ChatController` upgrades `GET chat/:room`, and handles the
 *   opening of its socket and its messages;
 * - `ToolsModule`: `Tools` has the command `build`.
 *
 * @returns The classes, and the list of what was created.
 */
export function shop(): Shop {
  const created: string[] = [];
  const CONFIG = token<string>("CONFIG");

  class Logger {
    constructor() {
      created.push("Logger");
    }
  }
  Injectable()(Logger);
  class SharedModule {}
  Module({
    providers: [
      provider({
        provide: CONFIG,
        factory: () => {
          created.push("CONFIG");
          return Promise.resolve("config");
        },
      }),
      Logger,
    ],
    exports: [CONFIG, Logger],
  })(SharedModule);

  class UsersService {
    constructor() {
      created.push("UsersService");
    }
  }
  Injectable([Logger])(loose(UsersService));
  class UsersController {
    list() {}
    get() {}
    create() {}
  }
  legacy(Get(""), UsersController, "list");
  legacy(Get(":id"), UsersController, "get");
  legacy(Post(""), UsersController, "create");
  legacy(loose(Middlewares(loose(audit))), UsersController, "create");
  loose(Middlewares(loose(auth)))(UsersController);
  Controller({ route: "users", dependencies: [UsersService] })(
    loose(UsersController),
  );
  class UsersModule {}
  Module({
    route: "v1",
    imports: [SharedModule],
    providers: [UsersService],
    controllers: [UsersController],
    exports: [UsersService],
  })(UsersModule);

  class OrdersService {}
  Injectable([UsersService, CONFIG])(loose(OrdersService));
  class OrdersEvents {
    paid() {}
    refunded() {}
  }
  legacy(loose(Subscribe("paid")), OrdersEvents, "paid");
  legacy(
    loose(Subscribe(contract({ topic: "orders.refunded" }))),
    OrdersEvents,
    "refunded",
  );
  MessageController({ topic: "orders", dependencies: [OrdersService] })(
    loose(OrdersEvents),
  );
  class OrdersFeed {
    feed() {}
  }
  legacy(loose(Sse("feed")), OrdersFeed, "feed");
  Controller({})(OrdersFeed);
  class OrdersModule {}
  Module({
    imports: [SharedModule, UsersModule],
    providers: [OrdersService],
    controllers: [OrdersEvents, OrdersFeed],
  })(OrdersModule);

  class ChatController {
    join() {}
    opened() {}
    message() {}
  }
  legacy(loose(Ws("chat/:room")), ChatController, "join");
  legacy(loose(WsOpen()), ChatController, "opened");
  legacy(loose(WsMessage()), ChatController, "message");
  Controller({})(ChatController);
  class ChatModule {}
  Module({ controllers: [ChatController] })(ChatModule);

  class Tools {
    build() {}
  }
  legacy(loose(Action("build")), Tools, "build");
  CommandController({})(Tools);
  class ToolsModule {}
  Module({ controllers: [Tools] })(ToolsModule);

  class App {}
  Module({ imports: [UsersModule, OrdersModule, ChatModule, ToolsModule] })(
    App,
  );
  return {
    App,
    SharedModule,
    UsersModule,
    OrdersModule,
    ChatModule,
    ToolsModule,
    Logger,
    UsersService,
    OrdersService,
    created,
  };
}

/** Create the web application of a root module, with the test linker. */
export function web_app(root: Class, prefix = ""): Promise<ChoWeb<unknown>> {
  return ChoWeb.create(root, { linker: new TestLinker(), prefix });
}

/** A linker of `@chojs/message` that keeps the routes, and has no broker. */
class KeepLinker implements Linker<readonly Route[]> {
  link(routes: readonly Route[]): Linked<readonly Route[]> {
    return {
      instance: routes,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    };
  }
}

/** Create the message application of a root module, with no broker. */
export function message_app(
  root: Class,
  prefix = "",
): Promise<ChoMessage<readonly Route[]>> {
  return ChoMessage.create(root, { linker: new KeepLinker(), prefix });
}

/** Send a request to a web application. */
export function send(app: ChoWeb<unknown>, path: string): Promise<Response> {
  return app.handler(new Request(`http://localhost${path}`));
}
