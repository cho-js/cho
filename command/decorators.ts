import { addToMetadataObject, type Any, normTarget } from "@chojs/core";

/**
 * Mark a method as the main command handler.
 * The main command is executed when no sub-command is provided.
 * todo carefully create a type to fit all environments
 *
 * This decorator can be applied to a method within a controller class.
 *
 * @constructor
 */
export function Main(): Any {
  return (target: Any, key?: string | symbol) => {
    addToMetadataObject(normTarget(target, key), { command: "main" });
  };
}

/**
 * Define a sub-command handler method.
 *
 * This decorator can be applied to methods within a controller class.
 *
 * @param name
 * @constructor
 */
export function Command(name: string): Any {
  return (target: Any, key?: string | symbol) => {
    addToMetadataObject(normTarget(target, key), { command: name });
  };
}

/**
 * Add help content to a command method or controller.
 * Invoked when --help or -h is provided.
 *
 * This decorator can be applied to either a class or a method
 * @param content
 * @constructor
 */
export function Help(content: string): ClassDecorator & Any {
  return (target: Any, key?: string | symbol) => {
    addToMetadataObject(normTarget(target, key), { help: content });
  };
}
