# @chojs/vendor-cho

[![JSR](https://jsr.io/badges/@chojs/vendor-cho)](https://jsr.io/@chojs/vendor-cho)
[![JSR score](https://jsr.io/badges/@chojs/vendor-cho/score)](https://jsr.io/@chojs/vendor-cho)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The plain router of CHO web applications, on the standard
[URL Pattern API](https://developer.mozilla.org/docs/Web/API/URL_Pattern_API).

**The router is now part of [`@chojs/web`](../../web/README.md)**, where it is
the default: an application that gives `ChoWeb.create` no linker gets it, with
nothing else to install.

```ts
import { ChoWeb } from "@chojs/web";

const app = await ChoWeb.create(App);
```

This package is kept for the applications that import from it. It exports the
same `ChoLinker` and `ChoRouter` as `@chojs/web`, so both lines give the same
class:

```ts
import { ChoLinker } from "@chojs/vendor-cho";
import { ChoLinker } from "@chojs/web";
```

New applications import from `@chojs/web`.

## Documentation

- [The built-in router](../../web/README.md#the-built-in-router): its options,
  the `ChoRouter`, and its behavior.
- [`@chojs/web`](../../web/README.md): the web package and its
  [specification](../../web/specs.md).

## License

[MIT](./LICENSE)
