/**
 * The parts `cho generate` writes, and the names it gives them.
 *
 * A part is a class of an application, in a file of its own: a controller, a
 * service, or a module.
 *
 * The name of a part is the name of its file, and of its class. No type is
 * added to it: `cho generate controller users` writes the class `Users`, in
 * `users.ts`.
 *
 * | Typed as       | The file          | The class     |
 * | -------------- | ----------------- | ------------- |
 * | `users`        | `users.ts`        | `Users`       |
 * | `userProfile`  | `user-profile.ts` | `UserProfile` |
 * | `UserProfile`  | `user-profile.ts` | `UserProfile` |
 * | `user-profile` | `user-profile.ts` | `UserProfile` |
 *
 * @module
 */

/** The parts, in the order they are proposed. */
export const PARTS = ["controller", "service", "module"] as const;

/** A part of an application. */
export type Part = typeof PARTS[number];

/** What a name is made of: letters, digits and `-`, starting with a letter. */
const PATTERN = /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/;

/** The number of characters a name has at most. */
const LENGTH = 64;

/**
 * What is wrong with the name of a part.
 *
 * @param name The name.
 * @returns The mistake, as a sentence with no full stop, or `undefined` when
 *   the name can be one.
 */
export function part_mistake(name: string): string | undefined {
  if (name === "") {
    return "A name is needed";
  }
  if (!PATTERN.test(name)) {
    return "Letters and digits, starting with a letter: users, userProfile " +
      "or user-profile";
  }
  if (name.length > LENGTH) {
    return `${LENGTH} characters at most`;
  }
  return undefined;
}

/**
 * The words of a name: it is cut at each `-`, and before each capital letter
 * that starts a word.
 *
 * `userProfile` is `user`, `Profile`, and `HTTPClient` is `HTTP`, `Client`.
 *
 * @param name The name. It has no mistake.
 * @returns The words, as they were typed.
 */
export function words_of(name: string): string[] {
  return name
    // aB: a word ends before a capital letter
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    // ABc: capitals in a row are a word, but the last one starts the next
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .split("-");
}

/**
 * The name of the file of a part, with no extension: its words, in lower
 * case, with `-` between them.
 *
 * @param name The name. It has no mistake.
 * @returns `user-profile`, for `userProfile`.
 */
export function file_name(name: string): string {
  return words_of(name).map((word) => word.toLowerCase()).join("-");
}

/**
 * The name of the class of a part: its words, each with a capital first
 * letter.
 *
 * @param name The name. It has no mistake.
 * @returns `UserProfile`, for `user-profile`.
 */
export function class_name(name: string): string {
  return words_of(name)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}
