import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChoWeb } from "@chojs/web";
import { AppModule } from "./app.ts";

describe("__name__", () => {
  it("answers GET /", async () => {
    // the handler takes a Request: a test needs no server
    const app = await ChoWeb.create(AppModule);
    const response = await app.handler(new Request("http://localhost/"));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Hello from __name__",
    });
    await app.close();
  });
});
