/**
 * Sending messages: {@link ChoMessageClient} sends the message of a contract,
 * and gives back its typed reply. It is built on a `Sender`, which each
 * adapter makes of the client of its broker.
 *
 * {@link localSender} is a sender with no broker: it delivers to an
 * application in the same process, for tests.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe, run_validator } from "@chojs/core/utils";
import { describe_issues } from "./args.ts";
import { type Contract, is_contract } from "./contract.ts";
import { message_error } from "./errors.ts";
import type { Delivery, Reply, RequestOptions, Sender } from "./linker.ts";
import { join_topic, normalize_topic } from "./topic.ts";

const decoder = new TextDecoder();

/** The options of {@link ChoMessageClient}. */
export type ChoMessageClientOptions = {
  /**
   * The prefix of the application that listens: the `prefix` option of its
   * `ChoMessage.create` (`"staging"`). It is put before the topic of each
   * contract. Default: none.
   */
  readonly prefix?: string | undefined;
  /**
   * The milliseconds a request waits for its answer, when the request does
   * not say. Default: the sender's.
   */
  readonly timeout?: number | undefined;
};

/** The options of a message that is sent. */
export type ChoMessageSendOptions = {
  /** The key of the message, on a broker that has keys. */
  readonly key?: string | undefined;
  /** The headers of the message. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
};

/** The options of a request. */
export type ChoMessageRequestOptions = ChoMessageSendOptions & RequestOptions;

/**
 * The value to send for a contract, and the options: the value can be left
 * out when the contract lets it be `undefined`.
 *
 * @typeParam Sent What is sent: the `Sent` of the contract.
 * @typeParam Options The options of the call.
 */
export type ChoMessageSent<Sent, Options> = undefined extends Sent
  ? [value?: Sent, options?: Options]
  : [value: Sent, options?: Options];

/**
 * Sends the messages of contracts.
 *
 * A contract speaks JSON: the value is sent as JSON, and the reply is read
 * as JSON. The types of both come from the contract.
 *
 * @example
 * ```ts
 * const client = new ChoMessageClient(linker.sender);
 *
 * await client.publish(OrderCreated, { id: 7, total: 12 });
 * const { price } = await client.request(GetPrice, { id: 7 });
 * ```
 *
 * @example Provided to an application
 * ```ts
 * const linker = new NatsLinker({ connect, queue: "shop" });
 *
 * @Module({
 *   providers: [
 *     provider({
 *       provide: ChoMessageClient,
 *       factory: () => new ChoMessageClient(linker.sender),
 *     }),
 *   ],
 *   controllers: [OrdersController],
 * })
 * class AppModule {}
 *
 * const app = await ChoMessage.create(AppModule, { linker });
 * ```
 */
export class ChoMessageClient {
  readonly #sender: Sender;
  readonly #prefix: string;
  readonly #timeout: number | undefined;

  /**
   * Make a client. Nothing is sent, or connected, yet.
   *
   * @param sender What sends: the `sender` of the linker of an adapter, or
   *   {@link localSender} in a test.
   * @param options The prefix of the topics, and how long a request waits.
   * @throws {ChoError} `CHO_MESSAGE_INVALID_CLIENT` when the sender is not
   *   one, or when an option is wrong; `CHO_MESSAGE_INVALID_TOPIC` when the
   *   prefix is not valid; `CHO_CORE_UNKNOWN_OPTION` for an option that does
   *   not exist.
   */
  constructor(sender: Sender, options: ChoMessageClientOptions = {}) {
    if (
      typeof sender !== "object" || sender === null ||
      typeof sender.publish !== "function" ||
      (sender.request !== undefined && typeof sender.request !== "function")
    ) {
      throw message_error(
        "CHO_MESSAGE_INVALID_CLIENT",
        `new ChoMessageClient(): expected a sender, such as the sender of a linker, got ${
          describe(sender)
        }`,
      );
    }
    if (typeof options !== "object" || options === null) {
      throw message_error(
        "CHO_MESSAGE_INVALID_CLIENT",
        `new ChoMessageClient(): expected options, such as { prefix: "staging" }, got ${
          describe(options)
        }`,
      );
    }
    assert_known_options("new ChoMessageClient()", options, [
      "prefix",
      "timeout",
    ]);
    assert_timeout("new ChoMessageClient()", options.timeout);
    this.#sender = sender;
    this.#prefix = options.prefix === undefined
      ? ""
      : normalize_topic(options.prefix, "the prefix of a ChoMessageClient");
    this.#timeout = options.timeout;
  }

  /**
   * Send a message that asks for no reply.
   *
   * @typeParam Request What the handler receives.
   * @typeParam Sent What is sent: `Request`, unless the validator of the
   *   request converts.
   * @param contract The contract of the message.
   * @param sent The value, and the key and the headers of the message.
   * @returns A promise that resolves when the message is given to the
   *   broker.
   * @throws {ChoError} (as a rejection) `CHO_MESSAGE_INVALID_CONTRACT` for
   *   what is not a contract; `CHO_MESSAGE_INVALID_VALUE` for a value that
   *   has no JSON.
   */
  async publish<Request, Sent = Request>(
    // deno-lint-ignore no-explicit-any
    contract: Contract<Request, any, Sent, any>,
    ...sent: ChoMessageSent<Sent, ChoMessageSendOptions>
  ): Promise<void> {
    const [value, options] = sent;
    const topic = this.#topic("publish", contract);
    await this.#sender.publish(topic, to_delivery(topic, value, options));
  }

  /**
   * Send a message that asks for a reply, and wait for it.
   *
   * @typeParam Request What the handler receives.
   * @typeParam Reply What is replied: what the validator of the reply gives.
   * @typeParam Sent What is sent: `Request`, unless the validator of the
   *   request converts.
   * @param contract The contract of the message.
   * @param sent The value, and the key, the headers and the time to wait.
   * @returns The reply, read as JSON and, when the contract has a `reply`
   *   validator, through it. An empty reply is `undefined`.
   * @throws {ReplyError} (as a rejection) When the other side answered with
   *   an error: its code, and its description.
   * @throws {ChoError} (as a rejection) `CHO_MESSAGE_NO_REPLIES` when the
   *   broker of the sender has no replies; `CHO_MESSAGE_NO_RESPONDERS` when
   *   nobody listens; `CHO_MESSAGE_REQUEST_TIMEOUT` when no answer came in
   *   time; `CHO_MESSAGE_UNEXPECTED_REPLY` when the reply is not JSON, or
   *   its validator refuses it.
   * @throws (as a rejection) What the `validate` function of the Standard
   *   Schema of the reply throws.
   */
  async request<Request, Reply, Sent = Request>(
    // deno-lint-ignore no-explicit-any
    contract: Contract<Request, Reply, Sent, any>,
    ...sent: ChoMessageSent<Sent, ChoMessageRequestOptions>
  ): Promise<Reply> {
    const [value, options] = sent;
    const topic = this.#topic("request", contract);
    if (!this.#sender.request) {
      throw message_error(
        "CHO_MESSAGE_NO_REPLIES",
        `ChoMessageClient.request(): the sender cannot ask "${topic}": its broker has no replies. Publish the message, or use an adapter whose broker has them`,
      );
    }
    assert_timeout("ChoMessageClient.request()", options?.timeout);
    const timeout = options?.timeout ?? this.#timeout;
    const reply = await this.#sender.request(
      topic,
      to_delivery(topic, value, options),
      timeout === undefined ? undefined : { timeout },
    );
    return await read_reply(contract, topic, reply);
  }

  /** The full topic of a contract, or an error for what is not one. */
  #topic(method: string, contract: Contract<unknown, unknown>): string {
    if (!is_contract(contract)) {
      throw message_error(
        "CHO_MESSAGE_INVALID_CONTRACT",
        `ChoMessageClient.${method}(): expected a contract, made by contract(), got ${
          describe(contract)
        }`,
      );
    }
    return join_topic([this.#prefix, contract.topic]);
  }
}

/** Assert that a time to wait is a positive number of milliseconds. */
function assert_timeout(where: string, timeout: unknown): void {
  if (
    timeout !== undefined &&
    !(typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)
  ) {
    throw message_error(
      "CHO_MESSAGE_INVALID_CLIENT",
      `${where}: "timeout" is a number of milliseconds, more than 0, got ${
        describe(timeout)
      }`,
    );
  }
}

/** The message to send: the value as JSON, with its key and its headers. */
function to_delivery(
  topic: string,
  value: unknown,
  options: ChoMessageSendOptions | undefined,
): Delivery {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (cause) {
    throw message_error(
      "CHO_MESSAGE_INVALID_VALUE",
      `Invalid value of a message to "${topic}": ${
        describe(value)
      } cannot be serialized as JSON`,
      { cause },
    );
  }
  // A function, or a symbol: JSON has no text for it.
  if (json === undefined && value !== undefined) {
    throw message_error(
      "CHO_MESSAGE_INVALID_VALUE",
      `Invalid value of a message to "${topic}": expected a value JSON can hold, got ${
        describe(value)
      }`,
    );
  }
  return {
    ...(json === undefined ? {} : { value: json }),
    ...(options?.key === undefined ? {} : { key: options.key }),
    ...(options?.headers === undefined ? {} : { headers: options.headers }),
  };
}

/** The reply of a request, read as JSON, and through its validator. */
async function read_reply<Reply>(
  contract: Contract<unknown, Reply>,
  topic: string,
  reply: Reply_ | undefined,
): Promise<Reply> {
  let value: unknown;
  if (reply !== undefined && reply.value.length > 0) {
    try {
      value = JSON.parse(decoder.decode(reply.value));
    } catch (cause) {
      throw message_error(
        "CHO_MESSAGE_UNEXPECTED_REPLY",
        `Unexpected reply to the request of "${topic}": it is not JSON`,
        { cause },
      );
    }
  }
  if (!contract.reply) {
    return value as Reply;
  }
  const result = await run_validator(contract.reply, value);
  if (result.issues) {
    throw message_error(
      "CHO_MESSAGE_UNEXPECTED_REPLY",
      `Unexpected reply to the request of "${topic}": the validator of its contract refused it: ${
        describe_issues(result.issues)
      }`,
      "error" in result ? { cause: result.error } : undefined,
    );
  }
  return result.value;
}

/** The reply a sender gives: named apart from the type parameter `Reply`. */
type Reply_ = Reply;

/** What {@link localSender} delivers to: an application, or its `handle`. */
export type LocalApplication = {
  /** Deliver a message, and resolve with its reply: `ChoMessage.handle`. */
  handle(topic: string, message?: Delivery): Promise<Reply | undefined>;
};

/**
 * A sender with no broker: it delivers each message to an application in the
 * same process, with `app.handle`. It is for tests: a client and the
 * application it talks to, end to end.
 *
 * - `publish` resolves when the message is handled, and rejects with its
 *   error when it failed.
 * - `request` resolves with the reply of the handler, and rejects with what
 *   it threw: a `ReplyError` as it is.
 * - A topic that has no handler rejects with `CHO_MESSAGE_UNKNOWN_TOPIC`.
 *
 * @param app The application: a `ChoMessage`.
 * @returns The sender.
 * @throws {ChoError} `CHO_MESSAGE_INVALID_CLIENT` when what is given has no
 *   `handle`.
 *
 * @example
 * ```ts
 * const app = await ChoMessage.create(AppModule);
 * const client = new ChoMessageClient(localSender(app));
 * assert.deepEqual(await client.request(GetPrice, { id: 7 }), { id: 7, price: 42 });
 * ```
 */
export function localSender(app: LocalApplication): Sender {
  if (
    typeof app !== "object" || app === null || typeof app.handle !== "function"
  ) {
    throw message_error(
      "CHO_MESSAGE_INVALID_CLIENT",
      `localSender(): expected an application, such as what ChoMessage.create gives, got ${
        describe(app)
      }`,
    );
  }
  return {
    async publish(topic, delivery) {
      await app.handle(topic, delivery);
    },
    request: (topic, delivery) => app.handle(topic, delivery),
  };
}
