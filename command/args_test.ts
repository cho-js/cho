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
