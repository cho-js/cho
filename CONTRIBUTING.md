# How to contribute

I'm really glad you're reading this, we need volunteer developers to help bring
this project to fruition.

### Did you find a bug?

- Ensure the bug was not already reported by searching on GitHub under
  [Issues](https://github.com/cho-js/cho/issues).
- If you're unable to find an open issue addressing the problem,
  [open a new one](https://github.com/cho-js/cho/issues/new). Be sure to include
  a title and clear description, as much relevant information as possible, and a
  code sample or an executable test case demonstrating the expected behavior
  that is not occurring.

### Did you write a patch that fixes a bug?

- Open a new GitHub pull request with the patch.
- Ensure the PR description clearly describes the problem and solution. Include
  the relevant issue number if applicable.

### Do you have a new idea? A feature request?

Create a new issue describing the feature you would like to see implemented. Be
sure to include a clear description of the problem you're trying to solve and
how your proposed feature would solve it. If you have any relevant code samples
or mockups, please include them as well.

## Development

### Naming

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
