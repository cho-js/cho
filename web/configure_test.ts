/**
 * Tests for `configure` of `@chojs/core`, with a feature module of
 * `@chojs/web`: a module of a library, given its settings by an application.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legacy } from "@chojs/core/utils/test_utils";
import {
  ChoWeb,
  configure,
  Controller,
  Get,
  Injectable,
  Middlewares,
  Module,
  provider,
  token,
} from "./mod.ts";
import { TestLinker } from "./testing.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";

type MailOptions = { from: string };
const MAIL_OPTIONS = token<MailOptions>("MAIL_OPTIONS");

/** A feature of a library: a route, a middleware, and settings to be given. */
function library() {
  class Mailer {
    constructor(readonly options: MailOptions) {}
  }
  Injectable([MAIL_OPTIONS])(Mailer);
  class MailController {
    constructor(readonly mailer: Mailer) {}
    from() {
      return this.mailer.options;
    }
  }
  legacy(Get("from"), MailController, "from");
  Controller({ dependencies: [Mailer] })(MailController);
  const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
    const response = await next();
    response.headers.set("x-feature", "mail");
    return response;
  };
  class MailModule {}
  Middlewares(stamp)(MailModule);
  Module({
    route: "mail",
    providers: [
      provider({
        provide: MAIL_OPTIONS,
        factory: (): MailOptions => {
          throw new Error("give MAIL_OPTIONS to MailModule, with configure()");
        },
      }),
      Mailer,
    ],
    controllers: [MailController],
  })(MailModule);
  return { MailModule };
}

/** An application that imports the given modules. */
function app_of(...imports: (new () => object)[]) {
  class App {}
  Module({ imports })(App);
  return ChoWeb.create(App, { linker: new TestLinker() });
}

const send = (app: ChoWeb<unknown>, path: string) =>
  app.handler(new Request(`http://localhost${path}`));

describe("a feature made by configure", () => {
  it("serves the routes of the module, at its route, with its middlewares", async () => {
    const { MailModule } = library();
    class Config {
      from = "shop@example.com";
    }
    Injectable()(Config);
    class ConfigModule {}
    Module({ providers: [Config], exports: [Config] })(ConfigModule);

    const Mail = configure(MailModule, {
      imports: [ConfigModule],
      providers: [
        provider({
          provide: MAIL_OPTIONS,
          deps: [Config],
          factory: (config) => ({ from: config.from }),
        }),
      ],
    });
    const app = await app_of(Mail);
    const response = await send(app, "/mail/from");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { from: "shop@example.com" });
    assert.equal(response.headers.get("x-feature"), "mail");
    // One feature, as for any module.
    assert.equal(app.graph.features.length, 1);
    assert.equal(app.graph.features[0]!.route, "mail");
    await app.close();
  });

  it("leaves the module of the library as it was: it still needs its settings", async () => {
    const { MailModule } = library();
    configure(MailModule, {
      providers: [
        provider({ provide: MAIL_OPTIONS, factory: () => ({ from: "a" }) }),
      ],
    });
    await assert.rejects(app_of(MailModule), (error: Error) => {
      assert.equal(
        (error.cause as Error).message,
        "give MAIL_OPTIONS to MailModule, with configure()",
      );
      return true;
    });
  });

  it("is refused twice in one application: the two have the same routes", async () => {
    const { MailModule } = library();
    const given = (from: string) => ({
      providers: [
        provider({ provide: MAIL_OPTIONS, factory: () => ({ from }) }),
      ],
    });
    await assert.rejects(
      app_of(
        configure(MailModule, given("a")),
        configure(MailModule, given("b")),
      ),
      { code: "CHO_WEB_DUPLICATE_ROUTE" },
    );
  });
});
