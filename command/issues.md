# @chojs/command issues

Bugs and limitations of the current code, found while writing
`command/specs.md`. Each was reproduced against the current code.

## Bugs

1. **[FIXED] Class error handlers don't work.** A class given to `@Catch` is
   resolved with the injector, then the instance is called as a function, with
   the parsed `args` instead of the error (`ChoCommand.run`, `command.ts`). An
   instance is not callable, so the call throws: the original error is printed
   and the exit code is `2`, whatever the class does. A class that is not a
   provider in the controller's module fails the same way.

   **Fix:** `run()` now calls the instance's `handle(error, args)`, and its
   result gives the exit code, as a function handler's does. Function handlers
   receive the args too, `(error, args)`. A class that cannot be created, or
   whose `handle` throws, still prints the error and exits `2`. Tests in
   `command_test.ts`.

2. **A function error handler that throws makes `run()` reject** instead of
   resolving to an exit code, unlike every other failure.

3. **`@Middlewares` is silently ignored.** It comes from `@chojs/core` (the
   command module does not re-export it), is accepted on controllers and command
   methods, and never runs. Either run middlewares around a command or reject
   them.

## Limitations

4. **A flag before the action name swallows it.** Flags are not declared, so
   `./app -v ls` parses `ls` as the value of `-v`: there is no action, so the
   help is printed and the exit code is `0`, without running `ls`. `./app ls -v`
   works, and so does declaring the flag a boolean in `parseOptions`.

5. **An unknown action with `--help` is not reported.** `./app nope --help`
   prints the global help and exits `0`, without saying that `nope` is not a
   command.

6. **`CHO_DEBUG` does not change what `run()` prints.** Errors are always
   printed with `console.error`; the `cho` debug logger is not used. Decide
   whether errors should be silent unless debug logging is on.
