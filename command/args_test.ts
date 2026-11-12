/**
 * Tests for `args.ts`: the command-line parsers of the two modes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChoActionsParser, ChoMainParser } from "./args.ts";

describe("ChoMainParser", () => {
  const parser = new ChoMainParser();

  it("always routes to main", () => {
    assert.equal(parser.parse([]).route, "main");
    assert.equal(parser.parse(["copy", "a"]).route, "main");
  });

  it("keeps every positional", () => {
    assert.deepEqual(parser.parse(["a", "b"]).args._, ["a", "b"]);
  });

  it("parses flags as parseArgs does", () => {
    const { args } = parser.parse(["-f", "--name=x", "--out", "dir", "file"]);
    assert.deepEqual(args, { _: ["file"], f: true, name: "x", out: "dir" });
  });

  it("parses nothing reserved by default", () => {
    assert.deepEqual(parser.parse([]), {
      args: { _: [] },
      route: "main",
      help: false,
      version: false,
    });
  });
});

describe("ChoActionsParser", () => {
  const parser = new ChoActionsParser();

  it("routes to the first positional and removes it from `_`", () => {
    const { args, route } = parser.parse(["copy", "src", "dest"]);
    assert.equal(route, "copy");
    assert.deepEqual(args._, ["src", "dest"]);
  });

  it("keeps the flags", () => {
    const { args, route } = parser.parse(["rm", "path", "--force", "-r"]);
    assert.equal(route, "rm");
    assert.deepEqual(args, { _: ["path"], force: true, r: true });
  });

  it("routes to an empty string when there is no positional", () => {
    assert.deepEqual(parser.parse([]), {
      args: { _: [] },
      route: "",
      help: false,
      version: false,
    });
    assert.equal(parser.parse(["--force"]).route, "");
  });

  it("gives a numeric command name as a string", () => {
    const { args, route } = parser.parse(["42", "7"]);
    assert.equal(route, "42");
    // positionals are kept as typed
    assert.deepEqual(args._, ["7"]);
  });
});

describe("reserved flags", () => {
  const main = new ChoMainParser();
  const actions = new ChoActionsParser();

  it("reads --help and --version, and keeps them out of the args", () => {
    for (const parser of [main, actions]) {
      const { args, help, version } = parser.parse([
        "x",
        "--help",
        "--version",
      ]);
      assert.equal(help, true);
      assert.equal(version, true);
      assert.ok(!("help" in args) && !("version" in args));
    }
  });

  it("leaves -h and -v to the handler", () => {
    for (const parser of [main, actions]) {
      const { args, help, version } = parser.parse(["x", "-h", "-v"]);
      assert.equal(help, false);
      assert.equal(version, false);
      assert.equal(args["h"], true);
      assert.equal(args["v"], true);
    }
  });

  it("does not let --help consume the command name", () => {
    const { args, route, help } = actions.parse(["--help", "copy", "src"]);
    assert.equal(help, true);
    assert.equal(route, "copy");
    assert.deepEqual(args._, ["src"]);
  });

  it("reads --help=false, --no-help and --no-version as off", () => {
    for (const parser of [main, actions]) {
      for (
        const argv of [
          ["x", "--help=false", "--no-version", "y"],
          ["x", "--no-help", "--version=false", "y"],
        ]
      ) {
        const { args, help, version } = parser.parse(argv);
        assert.equal(help, false);
        assert.equal(version, false);
        // a negated flag does not consume the next token
        assert.equal(args._.at(-1), "y");
        assert.ok(!("no-help" in args) && !("no-version" in args));
      }
    }
  });
});

describe("parser options", () => {
  const main = new ChoMainParser();
  const actions = new ChoActionsParser();

  it("passes the options to parseArgs", () => {
    const { args } = main.parse(["--name", "42", "-f"], {
      string: ["name"],
      alias: { f: "force" },
    });
    assert.deepEqual(args, { _: [], name: "42", f: true, force: true });
  });

  it("lets a declared boolean flag come before the command name", () => {
    const { args, route } = actions.parse(["--force", "copy", "a"], {
      boolean: ["force"],
    });
    assert.equal(route, "copy");
    assert.deepEqual(args, { _: ["a"], force: true });
  });

  it("accepts a single name instead of a list", () => {
    const { route } = actions.parse(["--force", "copy"], { boolean: "force" });
    assert.equal(route, "copy");
  });

  it("keeps the reserved flags when other booleans are declared", () => {
    assert.deepEqual(
      actions.parse(["--help", "ls"], { boolean: ["verbose"] }),
      {
        args: { _: [], verbose: false },
        route: "ls",
        help: true,
        version: false,
      },
    );
  });

  it("keeps the reserved flags negatable when other flags are", () => {
    const parsed = main.parse(["--no-help", "--no-color"], {
      negatable: ["color"],
      boolean: ["color"],
    });
    assert.equal(parsed.help, false);
    assert.equal(parsed.args["color"], false);
  });

  it("keeps the reserved flags with boolean: true", () => {
    const parsed = actions.parse(["--help", "ls", "--x", "y"], {
      boolean: true,
    });
    assert.equal(parsed.route, "ls");
    assert.equal(parsed.help, true);
    assert.deepEqual(parsed.args, { _: ["y"], x: true });
  });

  it("does not let string, collect or default change the reserved flags", () => {
    const options = {
      string: ["help", "name"],
      collect: ["version"],
      default: { help: true, version: true, name: "x" },
    };
    assert.deepEqual(actions.parse(["ls"], options), {
      args: { _: [], name: "x" },
      route: "ls",
      help: false,
      version: false,
    });
    const parsed = actions.parse(["--help", "ls", "--version"], options);
    assert.equal(parsed.route, "ls");
    assert.equal(parsed.help, true);
    assert.equal(parsed.version, true);
  });

  it("does not change the caller's options", () => {
    const options = { boolean: ["force"], negatable: ["force"] };
    actions.parse(["--force"], options);
    assert.deepEqual(options, { boolean: ["force"], negatable: ["force"] });
  });
});

describe("positionals", () => {
  it("are kept as typed, never turned into numbers", () => {
    const argv = ["0501234567", "0x10", "1e3", "7"];
    assert.deepEqual(new ChoMainParser().parse(argv).args._, argv);
    assert.deepEqual(
      new ChoActionsParser(new Map([["call", undefined]]))
        .parse(["call", ...argv]).args._,
      argv,
    );
  });

  it("stay strings when the application declares string flags", () => {
    const { args } = new ChoMainParser().parse(["007", "--id", "008"], {
      string: ["id"],
    });
    assert.deepEqual(args, { _: ["007"], id: "008" });
  });

  it("still types the value of a flag that is not declared", () => {
    const { args } = new ChoMainParser().parse(["--id=007", "--name", "x"]);
    assert.deepEqual(args, { _: [], id: 7, name: "x" });
  });
});

describe("command flags", () => {
  const copy = {
    boolean: ["force"],
    string: ["mode"],
    collect: ["exclude"],
    negatable: ["color"],
    alias: { f: "force" },
    default: { mode: "644" },
  };
  const actions = new ChoActionsParser(
    new Map([["copy", copy], ["ls", undefined]]),
  );

  it("parse the command line of their command", () => {
    const { args, route } = actions.parse([
      "copy",
      "-f",
      "a",
      "--mode",
      "0755",
      "--exclude",
      "x",
      "--exclude",
      "y",
      "--no-color",
      "b",
    ]);
    assert.equal(route, "copy");
    assert.deepEqual(args, {
      _: ["a", "b"],
      f: true,
      force: true,
      mode: "0755",
      exclude: ["x", "y"],
      color: false,
    });
  });

  it("apply their defaults", () => {
    const { args } = actions.parse(["copy", "a"]);
    assert.equal(args.mode, "644");
    assert.equal(args.force, false);
    assert.equal("exclude" in args, false);
  });

  it("do not apply to another command", () => {
    const { args, route } = actions.parse(["ls", "--mode", "0755", "-f", "x"]);
    assert.equal(route, "ls");
    // undeclared for `ls`: typed from their look, and -f takes the next word
    assert.deepEqual(args, { _: [], mode: 755, f: "x" });
  });

  it("are added to the application's options", () => {
    const { args } = actions.parse(["copy", "--out", "01", "-v", "a"], {
      string: ["out"],
      boolean: ["v"],
    });
    assert.equal(args.out, "01");
    assert.equal(args.v, true);
    assert.equal(args.force, false);
    assert.deepEqual(args._, ["a"]);
  });

  it("apply to the single command of main mode", () => {
    const { args, route } = new ChoMainParser(copy).parse(["-f", "a"]);
    assert.equal(route, "main");
    assert.deepEqual(args._, ["a"]);
    assert.equal(args.force, true);
  });

  it("keep the reserved flags", () => {
    const { args, help } = actions.parse(["copy", "--help"]);
    assert.equal(help, true);
    assert.equal("help" in args, false);
  });
});

describe("finding the command", () => {
  const actions = new ChoActionsParser(
    new Map([["copy", { boolean: ["force"] }], ["ls", undefined]]),
  );

  it("is not fooled by an undeclared flag before the command", () => {
    const { args, route } = actions.parse(["-v", "ls", "dir"]);
    assert.equal(route, "ls");
    assert.deepEqual(args, { _: ["dir"], v: true });
  });

  it("skips words that are not commands: an undeclared flag's value", () => {
    const { args, route } = actions.parse(["--out", "dir", "copy", "a"]);
    assert.equal(route, "copy");
    assert.deepEqual(args, { _: ["a"], out: "dir", force: false });
  });

  it("takes a command's own flag given before its name", () => {
    const { args, route } = actions.parse(["--force", "copy", "a"]);
    assert.equal(route, "copy");
    assert.deepEqual(args, { _: ["a"], force: true });
  });

  it("never takes the value of a declared string flag as the command", () => {
    for (const argv of [["--out", "ls", "copy"], ["-o", "ls", "copy"]]) {
      const { args, route } = actions.parse(argv, {
        string: ["out"],
        alias: { o: "out" },
      });
      assert.equal(route, "copy");
      assert.equal(args.out, "ls");
    }
    // --out=ls holds its own value: the next word can be the command
    assert.equal(
      actions.parse(["--out=x", "ls"], { string: ["out"] }).route,
      "ls",
    );
  });

  it("does not look after --", () => {
    const { args, route } = actions.parse(["copy", "--", "ls"]);
    assert.equal(route, "copy");
    assert.deepEqual(args._, ["ls"]);
  });

  it("only removes the command name once", () => {
    const { args } = actions.parse(["copy", "copy", "ls"]);
    assert.deepEqual(args._, ["copy", "ls"]);
  });

  it("falls back to the first positional for an unknown command", () => {
    const { args, route } = actions.parse(["nope", "a"]);
    assert.equal(route, "nope");
    assert.deepEqual(args._, ["a"]);
    assert.equal(actions.parse(["--force"]).route, "");
  });
});
