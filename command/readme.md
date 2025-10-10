# `@chojs/command`

Allow creating command-line applications using decorators.

Main features:

1. CHO Dependency Injection
2. Single command or multiple sub-commands support
3. Parsing args using minimist api

## Installation

```shell
deno add jsr:@chojs/command
```

## Example

Single command example:

```ts

@Controller()
class CliController {
    @Main()
    main(ctx: ChoCommandContext) {
        console.log("Hello World");
    }
}
```

Multiple sub-commands example:

```ts

@Controller()
class CliController {
    @Command("greet")
    greet(ctx: ChoCommandContext) {
        console.log("Greetings!");
    }

    @Command("farewell")
    farewell(ctx: ChoCommandContext) {
        console.log("Farewell!");
    }
}
```

---

#### TODO

- [ ] Auto generate help message
- [ ] Add markdown support help content
- [ ] Complete test cases
- [ ] Add more examples
- [ ] Specifications tests