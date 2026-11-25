import { Injectable } from "@chojs/command";

/** A service: the injector creates it for the classes that depend on it. */
@Injectable()
export class __Name__ {
  /** Who answers. */
  hello(): string {
    return "Hello from __name__";
  }
}
