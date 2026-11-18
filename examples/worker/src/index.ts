/**
 * A Cloudflare Worker with `@chojs/web`.
 *
 * - The application is created once, at the top level of the module, and its
 *   handler is the `fetch` of the Worker: there is no `serve()` on a Worker.
 * - `Config` reads a binding of the Worker, `GREETING` (see `wrangler.toml`),
 *   with `env` of `cloudflare:workers`: a provider reaches the bindings as a
 *   handler does.
 * - `visits` counts after the answer is sent, with `waitUntil`.
 *
 * Run it with wrangler, from this folder:
 *
 * ```sh
 * npx wrangler dev
 * curl "http://localhost:8787/hello?name=you"
 * curl "http://localhost:8787/visits"
 * ```
 *
 * @module
 */
import {
  Args,
  ChoWeb,
  Controller,
  Get,
  HttpError,
  Injectable,
  Module,
  Query,
} from "@chojs/web";
import { env, waitUntil } from "cloudflare:workers";

/** The bindings of the Worker, as `wrangler.toml` declares them. */
type Bindings = { GREETING: string };

@Injectable()
class Config {
  /** Read when the application is created. */
  readonly greeting = (env as Bindings).GREETING;
}

@Injectable()
class Visits {
  count = 0;
  /** Work that takes a while: it runs after the answer. */
  async record(name: string) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.count++;
    console.log(`visit of ${name}: ${this.count}`);
  }
}

@Controller({ dependencies: [Config, Visits] })
class HelloController {
  constructor(readonly config: Config, readonly visits: Visits) {}

  @Get("hello")
  @Args(Query("name"))
  hello(name: string | undefined) {
    if (name === "") {
      throw new HttpError(400, "name is empty");
    }
    // The Worker stays alive until the promise settles.
    waitUntil(this.visits.record(name ?? "nobody"));
    return { message: `${this.config.greeting}, ${name ?? "world"}` };
  }

  @Get("visits")
  count() {
    return { visits: this.visits.count };
  }
}

@Module({ providers: [Config, Visits], controllers: [HelloController] })
class AppModule {}

// No I/O is allowed outside a request: an application whose providers
// connect to something is created in the first request instead.
const app = await ChoWeb.create(AppModule);

export default { fetch: app.handler };
