/**
 * What of a Worker a CHO application reaches, run by `tools/workerd/run.sh`
 * with no `nodejs_compat` flag: the bindings (`env`) and `waitUntil`, from a
 * handler and from the factory of a provider, on the built-in router and on
 * Hono.
 *
 * The Worker has one binding, `GREETING`: `build.mjs` declares it.
 */
import {
  ChoLinker,
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Injectable,
  Module,
  provider,
  token,
} from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";
import { env, waitUntil } from "cloudflare:workers";

const BINDING = "hello from a binding";

/** The work that finished after its response. */
const finished: string[] = [];
const later = (name: string) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      finished.push(name);
      resolve();
    }, 20)
  );

const GREETING = token<string>("GREETING");

@Injectable([GREETING])
class Config {
  constructor(readonly greeting: string) {}
}

@Controller({ route: "x", dependencies: [Config] })
class X {
  constructor(readonly config: Config) {}

  /** The module of the runtime: it works with every linker. */
  @Get("imported")
  imported() {
    waitUntil(later("imported"));
    return {
      env: (env as { GREETING: string }).GREETING,
      provider: this.config.greeting,
    };
  }

  /** The context of the HTTP runtime: Hono has the bindings in it. */
  @Get("native")
  native(ctx: ChoWebContext) {
    const native = ctx.native as {
      env?: { GREETING: string };
      executionCtx?: { waitUntil(promise: Promise<unknown>): void };
    } | undefined;
    native?.executionCtx?.waitUntil(later("native"));
    return { native: typeof native, env: native?.env?.GREETING };
  }
}

@Module({
  providers: [
    // Read when the application is created, at the top level of the module.
    provider({
      provide: GREETING,
      factory: () => (env as { GREETING: string }).GREETING,
    }),
    Config,
  ],
  controllers: [X],
})
class App {}

const builtin = await ChoWeb.create(App, { linker: new ChoLinker() });
const hono = await ChoWeb.create(App, { linker: new HonoLinker() });

type Fetch = (
  request: Request,
  env: unknown,
  ctx: unknown,
) => Promise<Response>;

export default {
  async test(_controller: unknown, bindings: unknown, ctx: unknown) {
    const checks: [string, boolean, string][] = [];
    // As the runtime calls a fetch handler: (request, env, ctx).
    const call = async (app: ChoWeb<unknown>, path: string) => {
      const response = await (app.handler as Fetch)(
        new Request(`https://worker.example/x/${path}`),
        bindings,
        ctx,
      );
      return await response.json() as Record<string, unknown>;
    };
    try {
      for (const [name, app] of [["built-in", builtin], ["hono", hono]] as const) {
        const imported = await call(app, "imported");
        checks.push([
          `${name}: env of cloudflare:workers, in a handler`,
          imported.env === BINDING,
          JSON.stringify(imported),
        ]);
        checks.push([
          `${name}: env of cloudflare:workers, in a provider`,
          imported.provider === BINDING,
          JSON.stringify(imported),
        ]);
      }
      const native = await call(hono, "native");
      checks.push([
        "hono: ctx.native.env",
        native.env === BINDING,
        JSON.stringify(native),
      ]);
      const plain = await call(builtin, "native");
      checks.push([
        "built-in: ctx.native is undefined",
        plain.native === "undefined",
        JSON.stringify(plain),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 80));
      checks.push([
        "the work given to waitUntil finished",
        finished.sort().join(",") === "imported,imported,native",
        finished.join(","),
      ]);
    } catch (error) {
      checks.push(["uncaught", false, String((error as Error)?.stack ?? error)]);
    }
    for (const [name, ok, detail] of checks) {
      if (!ok) console.log(`FAIL ${name} :: ${detail}`);
    }
    console.log(
      "RESULT " + JSON.stringify({
        pass: checks.filter(([, ok]) => ok).length,
        fail: checks.filter(([, ok]) => !ok).length,
        skip: 0,
      }),
    );
  },
};
