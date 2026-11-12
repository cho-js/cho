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
    // the remaining positionals are left as parseArgs gives them
    assert.deepEqual(args._, [7]);
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
