/**
 * Metadata utilities
 *
 * @example reading and writing metadata
 * ```ts
 * import {addToMetadataObject, readMetadataObject} from "@chojs/core/meta";
 *
 * class Example {
 * }
 *
 * addToMetadataObject(Example, {key0: "value0"});
 * addToMetadataObject(Example, {key1: "value1"});
 *
 * readMetadataObject(Example); // { key0: 'value0', key1: 'value1' }
 * ```
 *
 * @module
 */
export * from "./meta.ts";
