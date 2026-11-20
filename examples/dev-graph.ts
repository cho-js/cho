#!/usr/bin/env -S deno run --allow-all
/**
 * The tools of `@chojs/dev`, on a small shop: its endpoints, printed, and its
 * graph, as a page.
 *
 * - Nothing of the shop runs. `printEndpoints` and `graphPage` read what the
 *   decorators declare: no instance is created, and the database the shop
 *   would connect to is never asked for.
 * - `OrdersModule` has an HTTP controller and a message controller: the
 *   endpoints of both are listed.
 * - `UsersService` is exported by its module, and injected by another one:
 *   the page shows it with a double border, and an arrow that leaves its box.
 *
 * ```sh
 * deno run --allow-all examples/dev-graph.ts
 * bun examples/dev-graph.ts
 * npx tsx examples/dev-graph.ts
 * ```
 *
 * Run it, and open the file it names in a browser.
 *
 * @module
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ChoWebContext,
  type ChoWebNext,
  Controller,
  Get,
  Injectable,
  Middlewares,
  Module,
  Post,
  provider,
  token,
  Ws,
  WsMessage,
} from "@chojs/web";
import { Controller as Listener, Subscribe } from "@chojs/message";
import { graphPage, printEndpoints } from "@chojs/dev";

// What every module can use: the address of the database, and a log.
export const DATABASE_URL = token<string>("DATABASE_URL");

@Injectable()
export class Logger {
  log(message: string): void {
    console.log(message);
  }
}

@Injectable([DATABASE_URL, Logger])
export class Database {
  constructor(readonly url: string, readonly logger: Logger) {}
}

@Module({
  providers: [
    // Never called here: the tools create nothing.
    provider({
      provide: DATABASE_URL,
      factory: () => Promise.reject(new Error("no database in an example")),
    }),
    Logger,
    Database,
  ],
  exports: [Database, Logger],
})
export class SharedModule {}

// Users.
@Injectable([Database])
export class UsersRepository {
  constructor(readonly database: Database) {}
}

@Injectable([UsersRepository, Logger])
export class UsersService {
  constructor(readonly users: UsersRepository, readonly logger: Logger) {}
}

/** A middleware: its name is what the tools show. */
async function auth(_ctx: ChoWebContext, next: ChoWebNext): Promise<void> {
  await next();
}

@Middlewares(auth)
@Controller({ route: "users", dependencies: [UsersService] })
export class UsersController {
  constructor(readonly users: UsersService) {}

  @Get("")
  list() {}

  @Get(":id")
  get() {}

  @Post("")
  create() {}
}

@Module({
  imports: [SharedModule],
  providers: [UsersRepository, UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}

// Orders: reached by HTTP, and by messages.
@Injectable([Database, UsersService])
export class OrdersService {
  constructor(readonly database: Database, readonly users: UsersService) {}
}

@Controller({ route: "orders", dependencies: [OrdersService] })
export class OrdersController {
  constructor(readonly orders: OrdersService) {}

  @Get("")
  list() {}

  @Post("")
  create() {}
}

@Listener({ topic: "orders", dependencies: [OrdersService, Logger] })
export class OrdersEvents {
  constructor(readonly orders: OrdersService, readonly logger: Logger) {}

  @Subscribe("paid")
  paid() {}

  @Subscribe("cancelled")
  cancelled() {}
}

@Module({
  imports: [SharedModule, UsersModule],
  providers: [OrdersService],
  controllers: [OrdersController, OrdersEvents],
})
export class OrdersModule {}

// A chat with the support, over a WebSocket.
@Controller({ route: "support", dependencies: [Logger] })
export class SupportController {
  constructor(readonly logger: Logger) {}

  @Ws(":room")
  join() {}

  @WsMessage()
  message() {}
}

@Module({ imports: [SharedModule], controllers: [SupportController] })
export class SupportModule {}

@Module({ imports: [UsersModule, OrdersModule, SupportModule] })
export class AppModule {}

printEndpoints(AppModule);

const file = join(tmpdir(), "cho-graph.html");
await writeFile(file, graphPage(AppModule, { title: "Shop" }));
console.log(`\nThe graph of the application: ${file}`);
