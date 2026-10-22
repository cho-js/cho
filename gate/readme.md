# @chojs/web

Gateway modules for `cho` framework.

Decorators for creating consumers for network protocols.

- `@Message(filter)` - Create a consumer for messages from a message broker
  (e.g. RabbitMQ, Kafka) with response handling for services communication
  patterns.
- `@Event(filter)` - Create a consumer for events from a message broker (e.g.
  RabbitMQ, Kafka) without response handling.

[See documentation at https://ziv.github.io/cho/](https://ziv.github.io/cho/)
