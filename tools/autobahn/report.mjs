/**
 * Reads the report of the Autobahn test suite, prints its result, and exits
 * with an error when a case failed.
 *
 *     node report.mjs <reports>/index.json [known]
 *
 * `known` is a list of cases, separated by commas, whose failure is the
 * runtime's own and is known: they are printed, and do not fail the run.
 *
 * A case passes with `OK`, `NON-STRICT` (the server did what the protocol
 * allows, not what the suite prefers) or `INFORMATIONAL` (nothing to judge).
 * `UNIMPLEMENTED` is a case for an extension the server does not have.
 */
import { readFileSync } from "node:fs";

const PASS = ["OK", "NON-STRICT", "INFORMATIONAL", "UNIMPLEMENTED"];

const index = JSON.parse(readFileSync(process.argv[2], "utf8"));
const known = (process.argv[3] ?? "").split(",").filter(Boolean);
let failed = 0;
for (const [agent, cases] of Object.entries(index)) {
  const counts = {};
  const problems = [];
  for (const [id, result] of Object.entries(cases)) {
    counts[result.behavior] = (counts[result.behavior] ?? 0) + 1;
    // How the connection was closed is judged apart from the messages.
    const close = result.behaviorClose;
    if (!PASS.includes(result.behavior) || !PASS.includes(close)) {
      if (known.includes(id)) {
        counts[`(${id}: ${result.behavior}, close ${close}: known)`] = 1;
      } else {
        problems.push(`${id}: ${result.behavior}, close ${close}`);
      }
    } else if (result.behavior !== "OK" || close !== "OK") {
      counts[`(${id}: ${result.behavior}, close ${close})`] = 1;
    }
  }
  const total = Object.keys(cases).length;
  console.log(`${agent}: ${total} cases`);
  for (const [behavior, count] of Object.entries(counts)) {
    console.log(
      behavior.startsWith("(") ? `  ${behavior}` : `  ${behavior}: ${count}`,
    );
  }
  for (const problem of problems) {
    console.log(`  FAILED ${problem}`);
  }
  failed += problems.length;
}
process.exit(failed > 0 ? 1 : 0);
