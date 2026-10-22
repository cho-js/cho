import { createMethodDecorator } from "@chojs/web/meta";
import type { Routed } from "@chojs/web";
import { addToMetadataObject, type InjectableDescriptor } from "@chojs/core";

export type GatewayDescriptor =
  & InjectableDescriptor
  & Partial<Pick<Routed, "middlewares">>;

/**
 * Gateway class decorator for marking a class as a message broker gateway.
 * Gateways handle communication with message brokers like Redis, NATS, MQTT, etc.
 *
 * Gateway is the equivalent of Controller in web applications.
 *
 * ```ts
 * @Gateway()
 * class RedisGateway {}
 * ```
 * @constructor
 * @param desc
 */
export function Gateway(desc: GatewayDescriptor) {
  return (target: Function) => {
    const data = {
      middlewares: desc?.middlewares ?? [],
      deps: desc?.deps ?? [],
    };
    addToMetadataObject(target, data);
  };
}

/**
 * Method decorator for listening to messages from a message broker and replying to them.
 *
 * @example
 * ```ts
 * class MyGateway {
 *   @MessageListener("event.name")
 *   streamEvents(stream, context) { ... }
 * }
 * ```
 */
export const MessageListener = createMethodDecorator<any, GatewayType>(
  "Message",
);

/**
 * Method decorator for listening to events (messages) from a message broker
 *
 * @example
 * ```ts
 * class MyGateway {
 *   @EventListener("event.name")
 *   streamEvents(stream, context) { ... }
 * }
 * ```
 */
export const EventListener = createMethodDecorator<any, GatewayType>("Event");
