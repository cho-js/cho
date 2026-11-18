/**
 * A stand-in for `node:test`, for workerd: it collects the suites and the
 * tests of a file, and runs them inside the `test` handler of a Worker.
 *
 * It has what the tests of CHO use: `describe` and `it`, each with `skip` and
 * `todo`, the `skip` and `timeout` options, and `before`, `after`,
 * `beforeEach` and `afterEach`.
 */

/** @typedef {{ items: object[], hooks: Record<string, Function[]> }} Suite */

const new_suite = () => ({
  items: [],
  hooks: { before: [], after: [], beforeEach: [], afterEach: [] },
});

const root = new_suite();
/** The suite whose body is running: `describe` and `it` add to it. */
let current = root;

/** Makes `describe` or `it`: `(name, fn)` or `(name, options, fn)`. */
function add(type, skip) {
  return (name, a, b) => {
    const [options, fn] = typeof a === "function" ? [{}, a] : [a ?? {}, b];
    current.items.push({
      type,
      name,
      fn,
      options,
      skip: skip || Boolean(options.skip) || Boolean(options.todo),
    });
  };
}

export const describe = Object.assign(add("suite", false), {
  skip: add("suite", true),
  todo: add("suite", true),
});
export const it = Object.assign(add("test", false), {
  skip: add("test", true),
  todo: add("test", true),
});
export const test = it;
export const suite = describe;

const hook = (name) => (fn) => void current.hooks[name].push(fn);
export const before = hook("before");
export const after = hook("after");
export const beforeEach = hook("beforeEach");
export const afterEach = hook("afterEach");

/** Reject when a test takes longer than its timeout. */
function with_timeout(promise, ms, name) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timeout after ${ms} ms: ${name}`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The first lines of an error, on one line. */
const short = (error) =>
  String(error?.stack ?? error).split("\n").slice(0, 6).join(" | ");

/**
 * Run a suite: its tests, and the suites in it. The body of a suite runs
 * here, inside the handler, where a Worker may use timers and random values.
 */
async function run_suite(suite, path, each, result) {
  const fail = (name, error) => {
    result.fail++;
    result.lines.push(`FAIL ${name} :: ${short(error)}`);
  };
  try {
    for (const fn of suite.hooks.before) await fn();
  } catch (error) {
    fail([...path, "before"].join(" > "), error);
  }
  const before_each = [...each.before, ...suite.hooks.beforeEach];
  const after_each = [...suite.hooks.afterEach, ...each.after];
  for (const item of suite.items) {
    const name = [...path, item.name].join(" > ");
    if (item.skip) {
      result.skip++;
      continue;
    }
    if (item.type === "suite") {
      const child = new_suite();
      const previous = current;
      current = child;
      try {
        await item.fn();
      } catch (error) {
        fail(`${name} (its body)`, error);
      } finally {
        current = previous;
      }
      await run_suite(
        child,
        [...path, item.name],
        { before: before_each, after: after_each },
        result,
      );
      continue;
    }
    try {
      for (const fn of before_each) await fn();
      await with_timeout(
        Promise.resolve().then(() => item.fn({})),
        item.options.timeout ?? 20_000,
        name,
      );
      result.pass++;
    } catch (error) {
      fail(name, error);
    } finally {
      for (const fn of after_each) {
        await Promise.resolve().then(fn).catch((error) => fail(name, error));
      }
    }
  }
  try {
    for (const fn of suite.hooks.after) await fn();
  } catch (error) {
    fail([...path, "after"].join(" > "), error);
  }
}

/**
 * Run what the file declared.
 *
 * @returns {Promise<{ pass: number, fail: number, skip: number, lines: string[] }>}
 */
export async function run_collected() {
  const result = { pass: 0, fail: 0, skip: 0, lines: [] };
  await run_suite(root, [], { before: [], after: [] }, result);
  return result;
}
