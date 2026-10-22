# CLI Module Documentation

The CLI module in CHO provides a decorator-based framework for building command-line applications. It allows developers to create CLI tools using familiar decorators and integrates seamlessly with the framework's dependency injection system.

## Overview

The CLI module enables developers to build command-line interfaces using decorators, similar to how web applications are built with HTTP method decorators. It supports both single command applications and multi-subcommand applications.

## Key Components

### Controllers

Controllers in the CLI module are classes decorated with `@Controller()` that contain command handlers.

```typescript
import {Controller} from "@chojs/core";
import {Command, Main} from "@chojs/command";

@Controller()
class MyCLIController {
  @Main()
  main() {
    console.log("Main command executed");
  }

  @Command("help")
  help() {
    console.log("Help command executed");
  }
}
```

### Decorators

#### `@Command(name: string, alias?: string)`

Defines a sub-command handler method within a controller class.

```typescript
class MyCLIController {
    @Command("create")
    createProject(ctx: ChoCommandContext) {
        console.log("Creating project...");
    }
}
```

#### `@Main()`

Marks a method as the main command handler, which is executed when no sub-command is provided.

```typescript
class MyCLIController {
    @Main()
    main(ctx: ChoCommandContext) {
        console.log("Main command executed");
    }
}
```

#### `@Help(content: string)`

Adds help content to a command or controller.

```typescript
@Help("Generate a new project scaffold")
@Command("new")
newProject(ctx: ChoCommandContext) {
  // Implementation
}
```

## Usage Example

Here's a complete example of a CLI application using the CHO framework:

```typescript
import {Controller, Module} from "@chojs/core";
import {Command, Main} from "@chojs/command";
import {ChoCommandContext} from "@chojs/command/context";

@Controller()
class CLIController {
  @Main()
  main(ctx: ChoCommandContext) {
    console.log("Hello from CHO CLI!");
  }

  @Command("greet")
  greet(ctx: ChoCommandContext) {
    console.log("Greetings!");
  }

  @Command("farewell")
  farewell(ctx: ChoCommandContext) {
    console.log("Farewell!");
  }
}

@Module({
  controllers: [CLIController]
})
class CLIModule {
}

// The CLI application would be run using:
// cho run cli-module.ts
```

## Module Structure

The CLI module is organized as follows:

- `cli-module.ts` - Main module that imports CLI controllers
- `cli-controller.ts` - Base CLI controller with basic commands
- `new-controller.ts` - Controller for creating new projects
- `mod.ts` - Module export file

## Integration with Core

The CLI module integrates with the core framework through:

1. **Dependency Injection**: CLI controllers can use `@Injectable` services
2. **Context Handling**: Commands receive a `ChoCommandContext` with command-line arguments
3. **Module System**: CLI applications are organized using `@Module` decorator

## Available Commands

The CHO CLI tool provides several built-in commands:

- `cho new` - Generate a new project scaffold
- `cho generate` - Generate code
- `cho help` - Display help information

## Command Context

The `ChoCommandContext` provides access to command-line arguments and other context information:

```typescript
interface ChoCommandContext {
  args: string[];           // Command-line arguments
  flags: Record<string, any>; // Command-line flags
  cwd: string;              // Current working directory
}
```

## Best Practices

1. Use `@Main()` for the default command when no sub-command is specified
2. Use `@Command()` for sub-commands with descriptive names
3. Use `@Help()` to document commands for better user experience
4. Leverage dependency injection for complex command logic
5. Organize related commands into controllers for better maintainability
