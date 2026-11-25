import { Action, Controller, Help } from "@chojs/command";

/** The commands of `__name__`. */
@Controller()
export class __Name__ {
  /** `__name__`: says hello. */
  @Help("Say hello from __name__")
  @Action("__name__")
  hello() {
    console.log("Hello from __name__");
  }
}
