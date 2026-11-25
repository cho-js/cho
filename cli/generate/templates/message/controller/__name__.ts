import { Controller, Subscribe } from "@chojs/message";

/** The handlers of the topics of `__name__`. */
@Controller({ topic: "__name__" })
export class __Name__ {
  /** The topic `__name__.hello`: says that a message came. */
  @Subscribe("hello")
  hello() {
    console.log("Hello from __name__");
  }
}
