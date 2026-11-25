import { Controller, Get } from "@chojs/web";

/** The routes of `/__name__`. */
@Controller({ route: "__name__" })
export class __Name__ {
  /** `GET /__name__`: who answers. */
  @Get("")
  hello() {
    return { message: "Hello from __name__" };
  }
}
