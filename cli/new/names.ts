/**
 * The rule of a name: the name of a workspace, the name of a project, and the
 * folder of the projects follow it.
 *
 * Such a name is a folder on every system, and a name of a package for Deno,
 * for npm and for JSR. `cho.json` and its schema use the same constants.
 *
 * @module
 */

/** What a name is made of: the source of a regular expression. */
export const NAME_PATTERN = "^[a-z][a-z0-9-]*$";

/** The number of characters a name has at most. */
export const NAME_LENGTH = 64;

/** The names Windows keeps for a device: none can be a folder there. */
export const DEVICE_NAMES: readonly string[] = [
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
];

const PATTERN = new RegExp(NAME_PATTERN);

/**
 * What is wrong with a name.
 *
 * @param name The name.
 * @returns The mistake, as a sentence with no full stop, or `undefined` when
 *   the name follows the rule.
 */
export function name_mistake(name: string): string | undefined {
  if (name === "") {
    return "A name is needed";
  }
  if (!PATTERN.test(name)) {
    return "Lower case letters, digits and -, starting with a letter";
  }
  if (name.length > NAME_LENGTH) {
    return `${NAME_LENGTH} characters at most`;
  }
  if (DEVICE_NAMES.includes(name)) {
    return `Windows keeps the name ${JSON.stringify(name)} for a device`;
  }
  return undefined;
}
