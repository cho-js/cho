#!/usr/bin/env deno run --allow-env example/00-di-example.ts
import {Dependencies, Module} from "@chojs/core";
import {Injector} from "@chojs/core/internals";


@Dependencies("foo")
class ExampleService {
    constructor(readonly foo: string) {
    }
}

@Module({
    providers: [
        ExampleService,
        {
            provide: "foo",
            factory: () => Promise.resolve("FOO"),
        }
    ]
})
class ExampleModule {
}

const inj = await Injector.get(ExampleModule);
const ser = await inj.resolve(ExampleService);
console.log(ser.foo === "FOO");