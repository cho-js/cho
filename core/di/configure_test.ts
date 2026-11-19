/**
 * Tests for `configure.ts`: a module made from another one, with more
 * imports and more providers.
 *
 * Decorators are applied as plain function calls (see `decorators_test.ts`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { configure } from "./configure.ts";
import { Controller, Injectable, Middlewares, Module } from "./decorators.ts";
import { Injector } from "./injector.ts";
import { read_metadata_object } from "./metadata.ts";
import { provider, token } from "./tokens.ts";
import { loose } from "../utils/test_utils.ts";

type MailOptions = { from: string };
const MAIL_OPTIONS = token<MailOptions>("MAIL_OPTIONS");

/**
 * A module of a library: a service that needs settings, a placeholder for
 * them, and a controller. `ran` counts the calls of the placeholder.
 */
function library() {
  const counts = { placeholder: 0, mailers: 0 };
  class Mailer {
    constructor(readonly options: MailOptions) {
      counts.mailers++;
    }
  }
  Injectable([MAIL_OPTIONS])(Mailer);
  class MailController {
    constructor(readonly mailer: Mailer) {}
  }
  Controller({ dependencies: [Mailer] })(MailController);
  class MailModule {}
  Module({
    providers: [
      provider({
        provide: MAIL_OPTIONS,
        factory: (): MailOptions => {
          counts.placeholder++;
          throw new Error("give MAIL_OPTIONS to MailModule, with configure()");
        },
      }),
      Mailer,
    ],
    controllers: [MailController],
    exports: [Mailer],
  })(MailModule);
  return { MailModule, Mailer, MailController, counts };
}

/** A provider of the settings, with a constant value. */
const options_of = (from: string) =>
  provider({ provide: MAIL_OPTIONS, factory: () => ({ from }) });

/** A module that imports the given ones. */
function app_of(...imports: (new () => object)[]) {
  class App {}
  Module({ imports })(App);
  return App;
}

describe("configure", () => {
  it("makes a module with the providers given, in place of the ones of the same token", async () => {
    const { MailModule, Mailer, counts } = library();
    const Mail = configure(MailModule, { providers: [options_of("a@x")] });
    const injector = new Injector(app_of(Mail));
    await injector.init();
    assert.deepEqual((await injector.resolve(Mailer)).options, { from: "a@x" });
    // The placeholder is not in the new module: it never ran.
    assert.equal(counts.placeholder, 0);
    assert.equal(counts.mailers, 1);
  });

  it("returns a new module, a class that extends the one it is given", () => {
    const { MailModule } = library();
    const Mail = configure(MailModule, { providers: [options_of("a@x")] });
    assert.notEqual(Mail, MailModule);
    assert.ok(new Mail() instanceof MailModule);
    assert.equal(Mail.name, "MailModule");
  });

  it("does not change the module it is given", async () => {
    const { MailModule } = library();
    const before = read_metadata_object(MailModule);
    configure(MailModule, { providers: [options_of("a@x")] });
    assert.equal(read_metadata_object(MailModule), before);
    // An application of the original still has the placeholder.
    await assert.rejects(new Injector(app_of(MailModule)).init(), {
      code: "CHO_CORE_CREATE_FAILED",
      message:
        "Failed to create InjectionToken(MAIL_OPTIONS) in module MailModule",
    });
  });

  it("keeps the controllers, the exports and the options of the module", async () => {
    const { MailModule, Mailer, MailController } = library();
    const Mail = configure(MailModule, { providers: [options_of("a@x")] });
    const injector = new Injector(app_of(Mail));
    const controller = await injector.resolve(MailController, Mail);
    assert.ok(controller instanceof MailController);
    assert.equal(controller.mailer, await injector.resolve(Mailer));
    const mdl = [...injector.modules()].find((one) => one.ctr === Mail)!;
    assert.deepEqual(mdl.meta.controllers.map((c) => c.provider.provide), [
      MailController,
    ]);
  });

  it("keeps the extra options, the middlewares and the dependencies of the module", async () => {
    class Dep {}
    Injectable()(Dep);
    const middleware = () => {};
    class Feature {
      constructor(readonly dep: Dep) {}
    }
    Middlewares(middleware)(Feature);
    loose(Module)({ providers: [Dep], dependencies: [Dep], route: "mail" })(
      Feature,
    );
    const Configured = configure(Feature, {});
    const injector = new Injector(app_of(loose(Configured)));
    const mdl = [...injector.modules()].find((one) => one.ctr === Configured)!;
    assert.equal(mdl.meta.options["route"], "mail");
    assert.deepEqual(mdl.meta.middlewares, [middleware]);
    const instance = await injector.resolve(Configured, Configured);
    assert.ok(instance instanceof Feature);
    assert.ok(instance.dep instanceof Dep);
  });

  it("adds a provider of a new token, private to the module", async () => {
    const EXTRA = token<string>("EXTRA");
    const { MailModule } = library();
    const Mail = configure(MailModule, {
      providers: [
        options_of("a@x"),
        provider({ provide: EXTRA, factory: () => "extra" }),
      ],
    });
    const injector = new Injector(app_of(Mail));
    assert.equal(await injector.resolve(EXTRA, Mail), "extra");
    // Not exported: the application does not see it.
    await assert.rejects(injector.resolve(EXTRA), {
      code: "CHO_CORE_NOT_VISIBLE",
    });
  });

  it("gives the providers the imports given, and the providers of the module", async () => {
    class Config {
      from = "config@x";
    }
    Injectable()(Config);
    class ConfigModule {}
    Module({ providers: [Config], exports: [Config] })(ConfigModule);
    const SUFFIX = token<string>("SUFFIX");
    class Lib {}
    Module({
      providers: [
        provider({ provide: SUFFIX, factory: () => "!" }),
        provider({
          provide: MAIL_OPTIONS,
          factory: () => ({ from: "default" }),
        }),
      ],
      exports: [MAIL_OPTIONS],
    })(Lib);
    const Configured = configure(Lib, {
      imports: [ConfigModule],
      providers: [
        provider({
          provide: MAIL_OPTIONS,
          deps: [Config, SUFFIX],
          factory: (config, suffix) => ({ from: config.from + suffix }),
        }),
      ],
    });
    const injector = new Injector(app_of(Configured));
    assert.deepEqual(await injector.resolve(MAIL_OPTIONS), {
      from: "config@x!",
    });
  });

  it("does not import twice a module the module already imports", () => {
    class Shared {}
    Module({})(Shared);
    class Lib {}
    Module({ imports: [Shared] })(Lib);
    const Configured = configure(Lib, { imports: [Shared] });
    const mdl = [...new Injector(app_of(Configured)).modules()].find((one) =>
      one.ctr === Configured
    )!;
    assert.equal(mdl.meta.imports.length, 1);
  });

  it("replaces a class provider with a provider object of the same class", async () => {
    class Clock {
      now = "real";
    }
    Injectable()(Clock);
    class Lib {}
    Module({ providers: [Clock], exports: [Clock] })(Lib);
    const Configured = configure(Lib, {
      providers: [
        provider({ provide: Clock, factory: () => ({ now: "given" }) }),
      ],
    });
    const injector = new Injector(app_of(Configured));
    assert.equal((await injector.resolve(Clock)).now, "given");
  });

  it("rejects two providers given for one token, when the injector is made", () => {
    const { MailModule } = library();
    const Mail = configure(MailModule, {
      providers: [options_of("a@x"), options_of("b@x")],
    });
    assert.throws(() => new Injector(app_of(Mail)), {
      code: "CHO_CORE_DUPLICATE_TOKEN",
    });
  });
});

describe("configure: the identity of the new module", () => {
  it("makes one more module for each call, with instances of its own", async () => {
    const { MailModule, Mailer, counts } = library();
    const A = configure(MailModule, { providers: [options_of("a@x")] });
    const B = configure(MailModule, { providers: [options_of("b@x")] });
    class UsesA {}
    Module({ imports: [A], exports: [Mailer] })(UsesA);
    class UsesB {}
    Module({ imports: [B], exports: [Mailer] })(UsesB);
    const injector = new Injector(app_of(UsesA, UsesB));
    const a = await injector.resolve(Mailer, UsesA);
    const b = await injector.resolve(Mailer, UsesB);
    assert.equal(a.options.from, "a@x");
    assert.equal(b.options.from, "b@x");
    assert.notEqual(a, b);
    assert.equal(counts.mailers, 2);
  });

  it("is one module when it is imported through several paths", async () => {
    const { MailModule, Mailer, counts } = library();
    const Mail = configure(MailModule, { providers: [options_of("a@x")] });
    class One {}
    Module({ imports: [Mail], exports: [Mailer] })(One);
    class Two {}
    Module({ imports: [Mail], exports: [Mailer] })(Two);
    const injector = new Injector(app_of(One, Two));
    assert.equal(
      await injector.resolve(Mailer, One),
      await injector.resolve(Mailer, Two),
    );
    assert.equal(counts.mailers, 1);
  });

  it("is not the module it is made from: who imports both has two", async () => {
    const { MailModule, Mailer } = library();
    const Mail = configure(MailModule, { providers: [options_of("a@x")] });
    const injector = new Injector(app_of(Mail, MailModule));
    assert.equal(
      [...injector.modules()].filter((one) => one.ctr.name === "MailModule")
        .length,
      2,
    );
    // Each has a Mailer of its own, so the application cannot tell which.
    await assert.rejects(injector.resolve(Mailer), {
      code: "CHO_CORE_AMBIGUOUS_TOKEN",
    });
  });

  it("names the new module as it is told, for an application with two", async () => {
    const { MailModule, Mailer } = library();
    const Orders = configure(MailModule, {
      name: "OrdersMail",
      providers: [options_of("orders@x")],
    });
    const Billing = configure(MailModule, {
      name: "BillingMail",
      providers: [options_of("billing@x")],
    });
    assert.equal(Orders.name, "OrdersMail");
    assert.equal(Billing.name, "BillingMail");
    // The error of an application that imports both tells them apart.
    await assert.rejects(
      new Injector(app_of(Orders, Billing)).resolve(Mailer),
      {
        code: "CHO_CORE_AMBIGUOUS_TOKEN",
        message: /OrdersMail, BillingMail export different instances of it/,
      },
    );
    const injector = new Injector(app_of(Orders));
    assert.equal((await injector.resolve(Mailer)).options.from, "orders@x");
  });

  it("configures a module that was made by configure", async () => {
    const LIMIT = token<number>("LIMIT");
    const { MailModule, Mailer } = library();
    const First = configure(MailModule, { providers: [options_of("a@x")] });
    const Second = configure(First, {
      providers: [
        options_of("b@x"),
        provider({ provide: LIMIT, factory: () => 5 }),
      ],
    });
    const injector = new Injector(app_of(Second));
    assert.equal((await injector.resolve(Mailer)).options.from, "b@x");
    assert.equal(await injector.resolve(LIMIT, Second), 5);
    assert.ok(new Second() instanceof MailModule);
  });

  it("exports the new class for a module that exports itself", async () => {
    class Self {}
    Module({ exports: [Self] })(Self);
    const Configured = configure(Self, {});
    const injector = new Injector(app_of(Configured));
    assert.ok(await injector.resolve(Configured) instanceof Self);
  });
});

describe("configure: what it refuses", () => {
  it("needs a module", () => {
    class Plain {}
    class Service {}
    Injectable()(Service);
    for (const given of [Plain, Service, undefined, "MailModule", {}]) {
      assert.throws(() => configure(loose(given), {}), {
        code: "CHO_CORE_NOT_A_MODULE",
        message:
          /^configure\(\): .+ is not a module\. Give it a @Module class\.$/,
      });
    }
  });

  it("does not take a class that only extends a module", () => {
    const { MailModule } = library();
    class Sub extends MailModule {}
    assert.throws(() => configure(Sub, {}), { code: "CHO_CORE_NOT_A_MODULE" });
  });

  it("checks its options", () => {
    const { MailModule } = library();
    assert.throws(() => configure(MailModule, loose(null)), {
      code: "CHO_CORE_INVALID_OPTION",
      message: /^configure\(\): expected options, such as/,
    });
    assert.throws(() => configure(MailModule, loose({ controllers: [] })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message:
        'configure(): unknown option "controllers". Known options: imports, name, providers',
    });
    for (const name of ["", 7]) {
      assert.throws(() => configure(MailModule, loose({ name })), {
        code: "CHO_CORE_INVALID_OPTION",
        message: /^configure\(\): "name" is a non-empty string, got/,
      });
    }
    assert.throws(() => configure(MailModule, loose({ imports: "Config" })), {
      code: "CHO_CORE_INVALID_OPTION",
    });
    assert.throws(() => configure(MailModule, loose({ providers: [42] })), {
      name: "ChoError",
    });
  });

  it("finds an import that is not a module when the injector is made", () => {
    const { MailModule } = library();
    class NotAModule {}
    const Mail = configure(MailModule, {
      imports: [NotAModule],
      providers: [options_of("a@x")],
    });
    assert.throws(() => new Injector(app_of(Mail)), {
      code: "CHO_CORE_NOT_A_MODULE",
    });
  });
});

// What the types refuse. Nothing here runs.
(() => {
  const { MailModule } = library();
  configure(MailModule, {
    providers: [
      // @ts-expect-error the settings have a `from`, which is a string
      provider({ provide: MAIL_OPTIONS, factory: () => ({ from: 7 }) }),
    ],
  });
  // @ts-expect-error controllers are not what configure adds
  configure(MailModule, { controllers: [] });
  // The result is a class of the instances of the module.
  const Mail: typeof MailModule = configure(MailModule, {});
  return Mail;
});
