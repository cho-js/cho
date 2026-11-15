/**
 * Topic validation, shared by the decorators and the graph builder.
 *
 * @module
 */

import { describe } from "@chojs/core/utils";

/** One segment of a topic: letters, digits, `_` and `-`. */
const TOPIC_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** The characters brokers use for patterns, which a topic cannot have. */
const WILDCARD = /[*>#]/;

/**
 * Assert that a topic is valid. The empty string is valid: there is no topic
 * at that level. Otherwise the topic is one or more segments separated by
 * `.`, where:
 *
 * - the topic does not start or end with `.`;
 * - no segment is empty (`a..b`);
 * - every segment is made of letters, digits, `_` and `-`;
 * - there is no pattern: no wildcard (`*`, `>`, `#`) and no parameter. A
 *   topic is a name, so it means the same on every broker.
 *
 * @param topic The topic to check.
 * @param where Where the topic is declared, for the error message.
 * @throws {TypeError} When the topic is not a string.
 * @throws {Error} When the topic is not valid.
 */
export function assert_topic(
  topic: unknown,
  where: string,
): asserts topic is string {
  if (typeof topic !== "string") {
    throw new TypeError(
      `Invalid topic of ${where}: expected a string, got ${describe(topic)}`,
    );
  }
  if (topic === "") {
    return;
  }
  const invalid = (reason: string) =>
    new Error(`Invalid topic ${describe(topic)} of ${where}: ${reason}`);
  if (topic.startsWith(".") || topic.endsWith(".")) {
    throw invalid('it must not start or end with "."');
  }
  for (const segment of topic.split(".")) {
    if (segment === "") {
      throw invalid('it must not contain an empty segment ("..")');
    }
    const wildcard = WILDCARD.exec(segment);
    if (wildcard) {
      throw invalid(
        `${describe(segment)} has a "${
          wildcard[0]
        }": wildcards are not part of the topic syntax`,
      );
    }
    if (!TOPIC_SEGMENT.test(segment)) {
      throw invalid(
        `${
          describe(segment)
        } is not a valid segment: write letters, digits, "_" and "-"`,
      );
    }
  }
}

/**
 * Trim a topic and assert that it is valid (see {@link assert_topic}).
 *
 * @param topic The topic as declared.
 * @param where Where the topic is declared, for the error message.
 * @returns The trimmed topic.
 */
export function normalize_topic(topic: unknown, where: string): string {
  const trimmed = typeof topic === "string" ? topic.trim() : topic;
  assert_topic(trimmed, where);
  return trimmed;
}

/**
 * Join the levels of a topic with `.`. A level that is `""` adds nothing.
 *
 * @param levels The topics of the application, the feature, the controller
 *   and the handler, each valid.
 * @returns The full topic; `""` when every level is empty.
 */
export function join_topic(levels: readonly string[]): string {
  return levels.filter((level) => level !== "").join(".");
}
