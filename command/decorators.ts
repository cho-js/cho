import {
  addToMetadataObject,
  type ClassMethodDecorator,
  Target,
} from "@chojs/core";

/**
 * Mark a method as the main command handler.
 * The main command is executed when no sub-command is provided.
 * @constructor
 */
export function Main(): ClassDecorator & ClassMethodDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { command: "main" });
  };
}

/**
 * Define a sub-command handler method.
 * @param name
 * @constructor
 */
export function Command(name: string): ClassDecorator & ClassMethodDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { command: name });
  };
}

/**
 * Add help content to a command method or controller.
 * Invoked when --help or -h is provided.
 *
 * @param content
 * @constructor
 */
export function Help(content: string): ClassDecorator & ClassMethodDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { help: content });
  };
}
