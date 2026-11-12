# @chojs/command issues

Bugs and limitations of the current code, found while writing
`command/specs.md`. Each was reproduced against the current code.

## Bugs

1. **[FIXED] `@Middlewares` is silently ignored.** It came from `@chojs/core`,
   was accepted on controllers and command methods, and never ran.

   **Fix:** `@chojs/command` exports its own typed `@Middlewares` and `@Catch`,
   and runs middlewares around a command, the way `@chojs/web` does
   (`command/specs.md`, section 4.3; `command/tasks.md`).

## Limitations

1. **[FIXED] A flag before the action name swallows it.** Flags were not
   declared, so `./app -v ls` parsed `ls` as the value of `-v`: there was no
   action, the help was printed and the exit code was `0`, without running `ls`.

   **Fix:** the command is now the first word that names an action
   (`command/specs.md`, section 3.4), and a flag right before it has no value:
   `-v ls dir` runs `ls` with `v: true`. Commands can also declare their flags
   (`@Action(name, flags)`).

2. **An unknown action with `--help` is not reported.** `./app nope --help`
   prints the global help and exits `0`, without saying that `nope` is not a
   command.

3. **Errors are always printed.** `run()` prints unhandled errors with
   `console.error`, whether or not debug logging is on. The `cho:command`
   context adds details (commands, runs, exit codes, errors), but cannot make
   the output quieter. Decide whether errors should be silent unless debug
   logging is on.

## Behavior changes

- **Positionals are strings.** `args._` used to hold numbers for words that
  looked like numbers (`007` gave `7`, `0x10` gave `16`); it now holds them as
  typed. Convert with `Number()` where a number is wanted.
- **The command is found before the line is parsed** (section 3.4 of the
  specification). `-v ls` used to give `v: "ls"` and no command.
- `@Main` and `@Action` take the flags of their command, listed in its `--help`.
- **A command receives a context**, `ChoCliContext`, not the parsed command
  line: `args.force` is now `ctx.args.force`.
- **An error handler receives `(error, ctx)`**, not `(error, args)`.
- **`@Middlewares` runs.** It was accepted and ignored.
- **`@Catch` on a module** handles the errors of its controllers' commands, and
  the `onError` option is the application's fallback.
- **`@Middlewares` and `@Catch` come from `@chojs/command`** (typed); the core's
  `@Catch` is no longer re-exported.
- A middleware or an error handler class without a `handle` method makes
  `ChoCommand.create` throw. A class error handler without one used to fail when
  an error reached it, with exit code `2`.
