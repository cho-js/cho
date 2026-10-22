# `@chojs/command`

Allow creating command-line applications using decorators.

## Specifications

- Creates a single command line application when a controllers method annotated with `@Main()` decorator.
- Creates multiple sub-commands when a controllers methods annotated with `@Command()` decorator.

### Single Command Specifications

- Allow single controller.
- One method in the entire application can be annotated with `@Main()` decorator.
- Help can be added using `@Help()` decorator on that method.
- Global help can be added using `@Help()` decorator on the controller class.

### Multiple Sub-Commands Specifications

- Allow multiple controllers.
- Multiple methods in the entire application can be annotated with `@Command()` decorator.
- Each command method can have its own help using `@Help()` decorator.
- Global help can be added using `@Help()` decorator on the controller class. Controller level help are merged together
  as global help for the application.

Main features:

1. CHO Dependency Injection
2. Single command or multiple sub-commands support
3. Parsing args using minimist api
4. Auto generated help message (coming soon)

## Installation

::: code-group

```shell [deno]
deno add jsr:@chojs/command
```

```shell [npm]
npx jsr add @chojs/command
```

:::

## Example

Single command example:

```ts

@Controller()
class CliController {
    @Help("This is a simple CLI application")
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
- [x] Complete test cases
- [ ] Add more examples
- [ ] Specifications tests
