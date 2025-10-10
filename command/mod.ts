/**
 * Command Application Module
 *
 * Allow creating command-line applications using decorators.
 *
 * Main features:
 * 1. Dependency Injection
 * 2. Single command or multiple sub-commands support
 * 3. Parsing args using minimist api
 *
 * @example single command
 * ```ts
 * @Controller()
 * class CliController {
 *
 *  @Main()
 *  main(ctx: ChoCommandContext) {
 *      console.log("Hello World");
 *  }
 * }
 * ```
 *
 * @example multiple sub-commands
 * ```ts
 * @Controller()
 * class CliController {
 *
 *   @Command("greet")
 *   greet(ctx: ChoCommandContext) {
 *     console.log("Greetings!");
 *   }
 *
 *   @Command("farewell")
 *   farewell(ctx: ChoCommandContext) {
 *     console.log("Farewell!");
 *   }
 * }
 * ```
 */
export * from "./application.ts";
export * from "./decorators.ts";
export * from "./context.ts";
