/**
 * Tests for `types.ts`: the type-level contracts of tokens, dependencies and
 * providers.
 *
 * These are compile-time checks. They fail when the file is type-checked
 * (`deno test` and `deno check` do that); at runtime every test passes
 * trivially. Runners that only strip types, such as `node --test`, do not
 * check them.
 */

import { describe, it } from "node:test";
import type { Injector } from "./injector.ts";
import { provider, token } from "./tokens.ts";
import type {
  InjectionToken,
  Provider,
  Resolved,
  ResolvedAll,
  Token,
} from "./types.ts";

/** `true` when `A` and `B` are exactly the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

/** Compiles only when `T` is `true`. Does nothing at runtime. */
function expect_type<T extends true>(): void {}

class Foo {
  foo = 1;
}
abstract class Base {
  abstract run(): void;
}
const URL = token<string>("url");
const SYM: unique symbol = Symbol("sym");

describe("Token", () => {
  it("accepts classes, abstract classes, injection tokens and symbols", () => {
    const tokens: Token[] = [Foo, Base, URL, SYM];
    void tokens;
  });

  it("rejects strings", () => {
    // @ts-expect-error strings are not tokens
    const t: Token = "url";
    void t;
  });

  it("carries the value type", () => {
    const t: Token<Foo> = Foo;
    // @ts-expect-error a Foo token is not a string token
    const wrong: Token<string> = Foo;
    void t;
    void wrong;
  });
});

describe("Resolved", () => {
  it("is the instance type for a class", () => {
    expect_type<Equal<Resolved<typeof Foo>, Foo>>();
  });

  it("is the instance type for an abstract class", () => {
    expect_type<Equal<Resolved<typeof Base>, Base>>();
  });

  it("is T for an InjectionToken<T>", () => {
    expect_type<Equal<Resolved<typeof URL>, string>>();
  });

  it("is unknown for a symbol", () => {
    expect_type<Equal<Resolved<typeof SYM>, unknown>>();
  });

  it("never adds undefined", () => {
    expect_type<Equal<undefined extends Resolved<typeof Foo> ? 1 : 0, 0>>();
  });
});

describe("ResolvedAll", () => {
  it("maps a list of dependencies to their values, in order", () => {
    expect_type<
      Equal<
        ResolvedAll<[typeof Foo, typeof URL, typeof SYM]>,
        [Foo, string, unknown]
      >
    >();
  });
});

describe("token", () => {
  it("returns an InjectionToken of the given type", () => {
    expect_type<Equal<typeof URL, InjectionToken<string>>>();
  });
});

describe("provider", () => {
  it("types the factory arguments from deps", () => {
    const p = provider({
      provide: token<string>("x"),
      deps: [Foo, URL, SYM],
      factory: (foo, url, sym) => {
        expect_type<Equal<typeof foo, Foo>>();
        expect_type<Equal<typeof url, string>>();
        expect_type<Equal<typeof sym, unknown>>();
        return Promise.resolve(url);
      },
    });
    expect_type<Equal<typeof p, Provider<string>>>();
  });

  it("requires the factory to return the token's type", () => {
    provider({
      provide: token<number>("n"),
      // @ts-expect-error the factory must resolve to a number
      factory: () => Promise.resolve("not a number"),
    });
  });

  it("requires the factory to return a promise", () => {
    provider({
      provide: token<number>("n"),
      // @ts-expect-error factories are async
      factory: () => 1,
    });
  });
});

describe("Injector.resolve", () => {
  it("infers the value type from the token", () => {
    // Type-only: never called.
    const check = (injector: Injector) => {
      expect_type<
        Equal<ReturnType<typeof injector.resolve<Foo>>, Promise<Foo>>
      >();
      const foo: Promise<Foo> = injector.resolve(Foo);
      const url: Promise<string> = injector.resolve(URL);
      void foo;
      void url;
    };
    void check;
  });
});
