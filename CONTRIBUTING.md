# How to contribute

TBD

## Naming

The name of a function says who it is for.

| What                                                   | Convention   | Examples                                           |
| ------------------------------------------------------ | ------------ | -------------------------------------------------- |
| Public API (userland): classes                         | `PascalCase` | `ChoWeb`, `ChoCommand`, `HonoLinker`               |
| Public API (userland): functions and methods           | `camelCase`  | `ChoWeb.create()`, `app.close()`, `route.handle()` |
| Decorators, public or internal                         | `PascalCase` | `@Injectable`, `@Get`, `@Action`                   |
| Internal functions and methods, **even when exported** | `snake_case` | `is_token`, `read_metadata_object`, `set_env`      |

- **`@chojs/core` is internal**, for now: every function and method in it is
  `snake_case`, and carries no compatibility promise. Applications get what they
  need from it through `@chojs/command` and `@chojs/web`, which re-export it.
  Some internal functions are still called by applications (`set_env`, on a
  runtime without `process`); they keep their internal name.
- **A single word fits both conventions** (`provider`, `token`, `env`,
  `compose`, `describe`, `debuglog`), so a function can move between the two
  audiences without a rename.
- **Methods follow their class**: a method of an internal class is `snake_case`
  (`DependencyNode.is_controller()`), a method of a public class is `camelCase`.
- The rule is about functions. Whatever the audience: properties and option keys
  are `camelCase` (`errorHandler`, `parseOptions`, `onError`), types are
  `PascalCase` (`ChoWebContext`), constants are `UPPER_SNAKE_CASE`
  (`METADATA_FORMAT`).
