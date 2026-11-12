# @chojs/command issues

Bugs and limitations of the current code, found while writing
`command/specs.md`. Each was reproduced against the current code.

## Bugs

1. **`@Middlewares` is silently ignored.** It comes from `@chojs/core` (the
   command module does not re-export it), is accepted on controllers and command
   methods, and never runs. Either run middlewares around a command or reject
   them.

## Limitations

1. **A flag before the action name swallows it.** Flags are not declared, so
   `./app -v ls` parses `ls` as the value of `-v`: there is no action, so the
   help is printed and the exit code is `0`, without running `ls`. `./app ls -v`
   works, and so does declaring the flag a boolean in `parseOptions`.

2. **An unknown action with `--help` is not reported.** `./app nope --help`
   prints the global help and exits `0`, without saying that `nope` is not a
   command.

3. **Errors are always printed.** `run()` prints unhandled errors with
   `console.error`, whether or not debug logging is on. The `cho:command`
   context adds details (commands, runs, exit codes, errors), but cannot make
   the output quieter. Decide whether errors should be silent unless debug
   logging is on.
