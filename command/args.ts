/**
 * Command-line parsing: splits `argv` into the command name, the reserved
 * flags (`--help`, `--version`) and the arguments a command method receives.
 *
 * A command declares its flags with `@Main` / `@Action` ({@link CommandFlags});
 * the application can declare flags for every command (`parseOptions`). A flag
 * that is not declared is typed by `parseArgs` from the command line alone
 * (see `@std/cli`).
 *
 * @module
 */
import { type Args, parseArgs, type ParseOptions } from "./lib/parse-args.ts";

/**
 * Command context: the parsed command line, exactly as `parseArgs` from
 * `@std/cli` returns it (minimist API).
 *
 * Positionals in `_` are always strings, as typed (`"007"` stays `"007"`).
 * The value of a flag that is not declared is typed from its look: `--n=42`
 * gives the number `42`; declare the flag as a `string` to keep it as typed.
 * In multi-command mode, `_` does not include the command name. The reserved
 * `--help` and `--version` flags are not included either.
 *
 * @example
 * ```ts
 * @Controller()
 * class Files {
 *   // ./fs copy a.txt b.txt --force --mode=644
 *   @Action("copy")
 *   copy(args: ChoArgs) {
 *     args._;     // ["a.txt", "b.txt"]
 *     args.force; // true
 *     args.mode;  // 644 (a number: `mode` is not declared)
 *   }
 * }
 * ```
 */
export type ChoArgs = Args;

/**
 * Options of `parseArgs` from `@std/cli`, to declare the handlers' flags (for
 * example `boolean: ["force"]`, so `--force copy` does not take `copy` as its
 * value).
 *
 * The reserved flags (`--help`, `--version`) always stay negatable booleans:
 * they are added to `boolean` and `negatable`, and removed from `string`,
 * `collect` and `default`.
 *
 * @example
 * ```ts
 * const options: ParserOptions = {
 *   boolean: ["force"],
 *   string: ["out"],
 *   alias: { f: "force", o: "out" },
 * };
 * const app = ChoCommand.create(App, { parseOptions: options });
 * ```
 */
export type ParserOptions = ParseOptions;

/**
 * The flags of one command, declared with `@Main(flags)` or
 * `@Action(name, flags)`. They are used when that command runs, on top of the
 * application's `parseOptions`, and listed in the command's `--help`.
 *
 * @example
 * ```ts
 * @Action("copy", {
 *   boolean: ["force"],
 *   string: ["mode"],
 *   collect: ["exclude"],
 *   alias: { f: "force" },
 *   default: { mode: "644" },
 *   describe: { force: "Overwrite existing files", mode: "File mode" },
 * })
 * copy(args: ChoArgs) {
 *   // ./fs copy a b -f --mode 0755 --exclude x --exclude y
 *   args.force;   // true
 *   args.mode;    // "0755": a declared string is kept as typed
 *   args.exclude; // ["x", "y"]
 * }
 * ```
 */
export type CommandFlags = {
  /** Flags without a value: `--force`. They never take the next word. */
  boolean?: readonly string[];
  /** Flags whose value is kept as typed: `--mode 0755` gives `"0755"`. */
  string?: readonly string[];
  /** Flags that can repeat; their values are collected in an array. */
  collect?: readonly string[];
  /** Boolean flags that can be turned off with `--no-<name>`. */
  negatable?: readonly string[];
  /** Other names of a flag, by flag name: `{ force: "f" }` or `{ f: "force" }`. */
  alias?: Readonly<Record<string, string | readonly string[]>>;
  /** The value of a flag that is not given. */
  default?: Readonly<Record<string, unknown>>;
  /** What each flag does, by flag name, for `--help`. */
  describe?: Readonly<Record<string, string>>;
};

/** The keys of {@link CommandFlags}. */
export const COMMAND_FLAG_KEYS: readonly string[] = [
  "boolean",
  "string",
  "collect",
  "negatable",
  "alias",
  "default",
  "describe",
];

/** A parsed command line. */
export type ParsedArgs = {
  /** What the handler receives. */
  args: ChoArgs;
  /** The command to run: `"main"` in single-command mode. */
  route: string;
  /** Whether `--help` was given. */
  help: boolean;
  /** Whether `--version` was given. */
  version: boolean;
};

/** The command-line parser of one mode. */
export interface ChoArgsParser {
  /**
   * Parse a command line.
   *
   * @param argv The command-line arguments, without the program name.
   * @param options The parser options.
   * @returns The route, the reserved flags and the arguments.
   */
  parse(argv: string[], options?: ParserOptions): ParsedArgs;
}

/**
 * The flags the application reserves for itself. Only long flags are
 * reserved, so handlers keep every short flag (`-h`, `-v`, ...).
 *
 * They are parsed as negatable booleans, so they never consume the next token
 * (`--help copy` is help for `copy`), and `--help=false` and `--no-help` turn
 * them off.
 */
const RESERVED = ["help", "version"] as const;

/**
 * Whether a flag name is reserved.
 *
 * @param name The flag name, without dashes.
 */
export function is_reserved(name: string): boolean {
  return (RESERVED as readonly string[]).includes(name);
}

/** A `parseArgs` list option (a name or a list of names) as a list. */
function to_list(value: string | readonly string[] | undefined): string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : [
    ...value,
  ];
}

/**
 * The `parseArgs` options: the caller's options, with the reserved flags kept
 * as negatable booleans whatever the caller declares.
 *
 * @param options The caller's options.
 * @returns The options to parse with.
 */
function parse_options(options: ParserOptions = {}): ParserOptions {
  const { boolean, negatable, string, collect, default: defaults, ...rest } =
    options;
  const merged: ParserOptions = {
    ...rest,
    // `boolean: true` makes every flag without a value a boolean, the reserved
    // ones included
    boolean: boolean === true
      ? true
      : [...RESERVED, ...to_list(boolean === false ? undefined : boolean)],
    negatable: [...RESERVED, ...to_list(negatable)],
    // "_" keeps the positionals as typed: "007" is not the number 7
    string: ["_", ...to_list(string).filter((name) => !is_reserved(name))],
    collect: to_list(collect).filter((name) => !is_reserved(name)),
  };
  if (defaults !== undefined) {
    merged.default = Object.fromEntries(
      Object.entries(defaults).filter(([name]) => !is_reserved(name)),
    );
  }
  return merged;
}

/**
 * Add the flags of a command to the application's parser options.
 *
 * @param options The application's `parseOptions`.
 * @param flags The command's flags, if it declares any.
 * @returns The options to parse that command with. The inputs are not changed.
 */
function with_flags(
  options: ParserOptions = {},
  flags: CommandFlags | undefined,
): ParserOptions {
  if (!flags) {
    return options;
  }
  const merged: ParserOptions = {
    ...options,
    string: [...to_list(options.string), ...(flags.string ?? [])],
    collect: [...to_list(options.collect), ...(flags.collect ?? [])],
    negatable: [...to_list(options.negatable), ...(flags.negatable ?? [])],
    alias: { ...options.alias, ...flags.alias },
  };
  if (options.boolean !== true) {
    merged.boolean = [
      ...to_list(options.boolean === false ? undefined : options.boolean),
      ...(flags.boolean ?? []),
    ];
  }
  if (options.default !== undefined || flags.default !== undefined) {
    merged.default = { ...options.default, ...flags.default };
  }
  return merged;
}

/**
 * Parse a command line, separating the reserved flags from the handler's
 * arguments.
 *
 * @param argv The command-line arguments.
 * @param options The parser options.
 * @returns The arguments and the reserved flags; no route yet.
 */
function parse(
  argv: string[],
  options?: ParserOptions,
): Omit<ParsedArgs, "route"> {
  const { help, version, ...args } = parseArgs(argv, parse_options(options));
  return { args, help: help === true, version: version === true };
}

/**
 * The parser of single-command mode: the route is always `"main"`, and every
 * positional argument stays in `_`.
 */
export class ChoMainParser implements ChoArgsParser {
  /** The flags the `@Main` command declares. */
  readonly #flags: CommandFlags | undefined;

  /**
   * @param flags The flags the `@Main` command declares, if any.
   */
  constructor(flags?: CommandFlags) {
    this.#flags = flags;
  }

  /**
   * Parse a command line, routed to `"main"`.
   *
   * @param argv The command-line arguments, without the program name.
   * @param options The application's parser options.
   * @returns The parsed command line.
   */
  parse(argv: string[], options?: ParserOptions): ParsedArgs {
    return { ...parse(argv, with_flags(options, this.#flags)), route: "main" };
  }
}

/**
 * The flags that take the next word as their value, according to the
 * application's options: its `string` and `collect` flags, and their aliases.
 *
 * @param options The application's parser options.
 * @returns The flag names, without dashes.
 */
function value_flags(options: ParserOptions = {}): Set<string> {
  const names = new Set([
    ...to_list(options.string),
    ...to_list(options.collect),
  ]);
  for (const [name, aliases] of Object.entries(options.alias ?? {})) {
    const group = [name, ...to_list(aliases as string | readonly string[])];
    if (group.some((n) => names.has(n))) {
      group.forEach((n) => names.add(n));
    }
  }
  return names;
}

/**
 * The parser of multi-command mode: finds the command to run, then parses the
 * rest of the command line with that command's flags.
 *
 * The command is the first word that names a command and is not a flag, a
 * flag's value, or after `--`:
 *
 * - `-v ls` runs `ls`: `-v` is not declared, and `ls` is a command;
 * - `--out dir copy` runs `copy`: `dir` is not a command;
 * - a word after a flag the application declares as `string` or `collect` is
 *   that flag's value, never the command (`--out copy copy` runs `copy` with
 *   `out: "copy"` once `out` is declared).
 *
 * The word is removed, and the rest is parsed with the application's options
 * and the command's flags. A flag right before the command name has no value
 * (`-v ls dir` gives `v: true` and `_: ["dir"]`). When no word names a command, the whole line is
 * parsed with the application's options: the route is the first positional
 * (`""` when there is none), removed from `_`.
 */
export class ChoActionsParser implements ChoArgsParser {
  /** The flags each command declares, by command name. */
  readonly #commands: ReadonlyMap<string, CommandFlags | undefined>;

  /**
   * @param commands The commands of the application, by name, with the flags
   *   each one declares. Default: none.
   */
  constructor(
    commands: ReadonlyMap<string, CommandFlags | undefined> = new Map(),
  ) {
    this.#commands = commands;
  }

  /**
   * The position of the command name in a command line.
   *
   * @param argv The command-line arguments.
   * @param options The application's parser options.
   * @returns The index of the command name, or `-1` when no word names one.
   */
  #find_command(argv: string[], options?: ParserOptions): number {
    const takes_value = value_flags(options);
    for (let i = 0; i < argv.length; i++) {
      const word = argv[i]!;
      if (word === "--") {
        break;
      }
      if (word.startsWith("-") && word !== "-") {
        // `--out dir`, `-o dir`: the next word is the flag's value
        const name = word.replace(/^-+/, "");
        const last = word.startsWith("--") ? name : name.slice(-1);
        if (!word.includes("=") && takes_value.has(last)) {
          i++;
        }
        continue;
      }
      if (this.#commands.has(word)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Parse a command line, routed to the command it names.
   *
   * @param argv The command-line arguments, without the program name.
   * @param options The application's parser options.
   * @returns The parsed command line.
   */
  parse(argv: string[], options?: ParserOptions): ParsedArgs {
    const at = this.#find_command(argv, options);
    if (at !== -1) {
      const route = argv[at]!;
      const rest = [...argv.slice(0, at), ...argv.slice(at + 1)];
      let flags = this.#commands.get(route);
      // A flag right before the command name did not take it as its value,
      // so it has none: it must not take the word that now follows it.
      const before = at > 0 ? argv[at - 1]! : "";
      if (before.startsWith("-") && before !== "-" && !before.includes("=")) {
        const name = before.replace(/^-+/, "");
        const last = before.startsWith("--") ? name : name.slice(-1);
        if (last && !before.startsWith("--no-")) {
          flags = { ...flags, boolean: [...(flags?.boolean ?? []), last] };
        }
      }
      return { ...parse(rest, with_flags(options, flags)), route };
    }
    const { args, help, version } = parse(argv, options);
    const [first, ...rest] = args._;
    const route = first === undefined ? "" : String(first);
    return { args: { ...args, _: rest }, route, help, version };
  }
}
